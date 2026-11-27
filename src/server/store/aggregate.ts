import type { RateSnapshot } from "@/engine";
import type { Access, Check, CheckEvent, ConfigEvent, Database, FeeVersion, User } from "../model";
import { appendAudit } from "./audit";
import type { Tx } from "./sql";

/**
 * Maps the workspace aggregate (`Database`, the shape every service already works on) to PostgreSQL.
 *
 * Services are unchanged: they still receive a `Database` and mutate it synchronously. The store loads
 * the aggregate for ONE workspace (the caller's tenant), lets the service run, then diffs and writes:
 *   - mutable check fields  -> UPDATE checks.doc
 *   - historical arrays     -> INSERT into records / audit_events (append-only)
 * Any change to an existing historical entry, a removed check, or a changed choice is rejected here
 * (`HistoryViolation`) and again by database triggers.
 */
export class HistoryViolation extends Error {
  constructor(message: string) {
    super(`Immutable history violated: ${message}`);
    this.name = "HistoryViolation";
  }
}

type CheckArrays = "estimates" | "quotes" | "outcomes" | "evidence" | "planChanges" | "events";
const COLLECTION: Record<Exclude<CheckArrays, "events">, string> = {
  estimates: "estimate",
  quotes: "quote",
  outcomes: "outcome",
  evidence: "evidence",
  planChanges: "plan_change",
};
const ARRAYS: CheckArrays[] = ["estimates", "quotes", "outcomes", "evidence", "planChanges", "events"];

function header(c: Check): Omit<Check, CheckArrays> {
  const { estimates: _e, quotes: _q, outcomes: _o, evidence: _v, planChanges: _p, events: _ev, ...rest } = c;
  return rest;
}

const iso = (v: Date | string) => new Date(v).toISOString();

export interface WorkspaceRow {
  id: string;
  name: string;
  is_demo: boolean;
  corridor: string;
  seeded_at: Date | string;
  check_counter: number;
  id_counter: number;
  pseudonym_key: string;
  fee_draft: Database["feeDraft"];
  audit_seq: string | number;
  audit_head: string;
}

export async function loadWorkspaceRow(tx: Tx, workspaceId: string, lock: boolean): Promise<WorkspaceRow | null> {
  const r = await tx.query<WorkspaceRow>(`SELECT * FROM workspaces WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [workspaceId]);
  return r.rows[0] ?? null;
}

/** Load the whole aggregate for one workspace, as seen by `userId`. */
export async function loadAggregate(tx: Tx, ws: WorkspaceRow, userId: string): Promise<Database> {
  const wid = ws.id;
  const members = (
    await tx.query<{ id: string; name: string; initials: string; access: Access; title: string }>(
      `SELECT u.id, u.name, u.initials, m.access, m.title FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 ORDER BY m.created_at, u.id`,
      [wid],
    )
  ).rows;
  const users: User[] = members.map((m) => ({ id: m.id, name: m.name, initials: m.initials, role: m.title, access: m.access, isAdmin: m.access === "admin" }));

  const checkRows = (await tx.query<{ id: string; doc: Check }>("SELECT id, doc FROM checks WHERE workspace_id = $1 ORDER BY length(id), id", [wid])).rows;
  const checks = new Map<string, Check>();
  for (const r of checkRows) checks.set(r.id, { ...r.doc, estimates: [], quotes: [], outcomes: [], evidence: [], planChanges: [], events: [] });

  const rates: RateSnapshot[] = [];
  const feeVersions: FeeVersion[] = [];
  const recs = (
    await tx.query<{ collection: string; parent_id: string; doc: unknown }>(
      "SELECT collection, parent_id, doc FROM records WHERE workspace_id = $1 ORDER BY collection, parent_id, seq",
      [wid],
    )
  ).rows;
  const byCollection = Object.fromEntries(Object.entries(COLLECTION).map(([k, v]) => [v, k])) as Record<string, Exclude<CheckArrays, "events">>;
  for (const r of recs) {
    if (r.collection === "rate") rates.push(r.doc as RateSnapshot);
    else if (r.collection === "fee_version") feeVersions.push(r.doc as FeeVersion);
    else {
      const c = checks.get(r.parent_id);
      if (!c) throw new HistoryViolation(`record for unknown check ${r.parent_id}`);
      (c[byCollection[r.collection]] as unknown[]).push(r.doc);
    }
  }

  const configEvents: ConfigEvent[] = [];
  const events = (
    await tx.query<{ check_id: string | null; id: string; at: Date | string; actor: string; type: string; message: string }>(
      "SELECT check_id, id, at, actor, type, message FROM audit_events WHERE workspace_id = $1 ORDER BY seq",
      [wid],
    )
  ).rows;
  for (const e of events) {
    const base = { id: e.id, at: iso(e.at), actor: e.actor, message: e.message };
    if (e.check_id === null) configEvents.push({ ...base, type: e.type as ConfigEvent["type"] });
    else checks.get(e.check_id)?.events.push({ ...base, type: e.type as CheckEvent["type"] });
  }

  return {
    schema: 1,
    seededAt: iso(ws.seeded_at),
    workspace: { id: wid, name: ws.name, isDemo: ws.is_demo, corridor: ws.corridor as "US→MX" },
    currentUserId: userId,
    users,
    checks: [...checks.values()],
    rates,
    feeVersions,
    feeDraft: ws.fee_draft ?? null,
    configEvents,
    counters: { check: ws.check_counter, id: ws.id_counter },
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function appended<T>(before: T[], after: T[], what: string): T[] {
  if (after.length < before.length) throw new HistoryViolation(`${what}: entries were removed`);
  for (let i = 0; i < before.length; i++) {
    if (!same(before[i], after[i])) throw new HistoryViolation(`${what}: entry ${i} was changed`);
  }
  return after.slice(before.length);
}

async function insertRecords(tx: Tx, wid: string, collection: string, parent: string, startSeq: number, docs: unknown[]) {
  for (let i = 0; i < docs.length; i++) {
    await tx.query("INSERT INTO records (workspace_id, collection, parent_id, seq, doc) VALUES ($1, $2, $3, $4, $5)", [
      wid,
      collection,
      parent,
      startSeq + i,
      JSON.stringify(docs[i]),
    ]);
  }
}

/**
 * Write the difference between `before` (as loaded, or an empty aggregate for a new workspace) and
 * `after` (as left by the service). Throws HistoryViolation on any attempt to rewrite history.
 */
export async function persistDiff(tx: Tx, ws: WorkspaceRow, before: Database, after: Database): Promise<void> {
  const wid = ws.id;
  if (after.workspace.id !== wid) throw new HistoryViolation("workspace identity changed");
  if (after.counters.check < before.counters.check || after.counters.id < before.counters.id) throw new HistoryViolation("ID counters went backwards");

  const prevChecks = new Map(before.checks.map((c) => [c.id, c]));
  for (const id of prevChecks.keys()) {
    if (!after.checks.some((c) => c.id === id)) throw new HistoryViolation(`check ${id} was deleted`);
  }

  const newEvents: { checkId: string | null; ev: CheckEvent | ConfigEvent; order: number }[] = [];
  let order = 0;

  for (const c of after.checks) {
    const prev = prevChecks.get(c.id);
    if (prev?.choice && !same(prev.choice, c.choice)) throw new HistoryViolation(`recorded choice on ${c.id} changed`);
    const h = header(c);
    if (!prev) {
      await tx.query("INSERT INTO checks (workspace_id, id, doc) VALUES ($1, $2, $3)", [wid, c.id, JSON.stringify(h)]);
    } else if (!same(header(prev), h)) {
      if (prev.createdAt !== c.createdAt || prev.createdBy !== c.createdBy || prev.supplierHash !== c.supplierHash || prev.isDemo !== c.isDemo) {
        throw new HistoryViolation(`identity fields of ${c.id} changed`);
      }
      await tx.query("UPDATE checks SET doc = $3 WHERE workspace_id = $1 AND id = $2", [wid, c.id, JSON.stringify(h)]);
    }
    for (const key of ARRAYS) {
      const was = (prev?.[key] ?? []) as unknown[];
      const added = appended(was, c[key] as unknown[], `${c.id} ${key}`);
      if (key === "events") for (const ev of added as CheckEvent[]) newEvents.push({ checkId: c.id, ev, order: order++ });
      else await insertRecords(tx, wid, COLLECTION[key], c.id, was.length, added);
    }
  }

  await insertRecords(tx, wid, "rate", "", before.rates.length, appended(before.rates, after.rates, "rates"));
  await insertRecords(tx, wid, "fee_version", "", before.feeVersions.length, appended(before.feeVersions, after.feeVersions, "fee versions"));
  for (const ev of appended(before.configEvents, after.configEvents, "configuration log")) newEvents.push({ checkId: null, ev, order: order++ });

  // The chain records events in append order (per check, then the configuration log), so the
  // aggregate reloads exactly as written. Views sort by timestamp for display.
  newEvents.sort((a, b) => a.order - b.order);
  const head = await appendAudit(
    tx,
    wid,
    { seq: Number(ws.audit_seq), hash: ws.audit_head },
    newEvents.map(({ checkId, ev }) => ({ checkId, id: ev.id, at: ev.at, actor: ev.actor, type: ev.type, message: ev.message })),
  );

  await tx.query(
    `UPDATE workspaces SET name = $2, is_demo = $3, corridor = $4, seeded_at = $5, check_counter = $6, id_counter = $7,
       fee_draft = $8, audit_seq = $9, audit_head = $10 WHERE id = $1`,
    [
      wid,
      after.workspace.name,
      after.workspace.isDemo,
      after.workspace.corridor,
      after.seededAt,
      after.counters.check,
      after.counters.id,
      after.feeDraft === null ? null : JSON.stringify(after.feeDraft),
      head.seq,
      head.hash,
    ],
  );
  ws.audit_seq = head.seq;
  ws.audit_head = head.hash;
}

export function emptyAggregate(like: Database): Database {
  return { ...like, users: [], checks: [], rates: [], feeVersions: [], configEvents: [], feeDraft: null, counters: { check: 0, id: 0 } };
}
