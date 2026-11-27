import { dec } from "@/engine";
import type { Check, CheckStatus, Database } from "./model";

/**
 * Check lifecycle.
 *
 *   draft ─► choose_route ─► awaiting_receipt ─┬─► reconciled
 *                                              ├─► no_reply ──┬─► reconciled   (late reply)
 *                                              │              └─► refused
 *                                              └─► refused                     (terminal)
 *
 * Every status change in the services goes through `assertTransition`. After every mutation the store
 * runs `assertDatabaseInvariants` and rolls the transaction back if anything is inconsistent.
 */
export const TRANSITIONS: Record<CheckStatus, readonly CheckStatus[]> = {
  draft: ["choose_route"],
  choose_route: ["awaiting_receipt"],
  awaiting_receipt: ["reconciled", "no_reply", "refused"],
  no_reply: ["reconciled", "refused"],
  refused: [],
  reconciled: [],
};

export const STATUSES = Object.keys(TRANSITIONS) as CheckStatus[];

export function canTransition(from: CheckStatus, to: CheckStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvariantError extends Error {
  constructor(public violations: string[]) {
    super(`Lifecycle invariant violated: ${violations.join("; ")}`);
    this.name = "InvariantError";
  }
}

const AFTER_CHOICE = new Set<CheckStatus>(["awaiting_receipt", "reconciled", "no_reply", "refused"]);

/** Returns every violated invariant for one check (empty when consistent). */
export function checkInvariants(c: Check): string[] {
  const v: string[] = [];
  const at = (msg: string) => v.push(`${c.id}: ${msg}`);

  if (!TRANSITIONS[c.status]) at(`unknown status "${c.status}"`);
  if (!/^[0-9a-f]{32}$/.test(c.supplierHash) && !/^[0-9a-f]{6}$/.test(c.supplierHash)) at("supplier ID is not a pseudonymous hex ID");

  // Choice <-> status.
  if (AFTER_CHOICE.has(c.status) !== !!c.choice) at(`status "${c.status}" is inconsistent with ${c.choice ? "a recorded" : "no"} choice`);
  if (c.status === "draft" && c.estimates.length > 0 && c.choice) at("a draft cannot have a recorded choice");
  if (c.choice) {
    const est = c.estimates.find((e) => e.id === c.choice!.estimateId);
    if (!est) at("choice refers to an estimate that does not exist");
    else if (!est.result.options.some((o) => o.optionId === c.choice!.optionId)) at("choice refers to an option not in its estimate");
  }

  // Outcomes.
  if (c.outcomes.length && !c.choice) at("an outcome exists without a recorded choice");
  const cur = c.outcomes.at(-1) ?? null;
  if (c.status === "reconciled" && cur?.result !== "received") at("reconciled without a received outcome");
  if ((c.status === "no_reply" || c.status === "refused") && cur?.result !== c.status) at(`status "${c.status}" does not match the current outcome`);
  if (c.status === "awaiting_receipt" && cur) at("awaiting receipt but an outcome is recorded");
  const seen = new Set<string>();
  for (const o of c.outcomes) {
    if (o.correctionOf && !seen.has(o.correctionOf)) at(`outcome ${o.id} corrects an outcome that is not earlier in the record`);
    seen.add(o.id);
    if (o.result === "received" && (o.amount === null || dec(o.amount).isNeg())) at(`outcome ${o.id} has no valid amount`);
    if (o.level === "verified" || o.level === "demo_verified") {
      const ev = c.evidence.find((e) => e.id === o.evidenceId);
      const mode = o.level === "verified" ? "live" : "demo";
      if (!ev) at(`outcome ${o.id} is ${o.level} without evidence`);
      else if (ev.result !== "verified" || ev.mode !== mode || !ev.file || o.amount === null || !dec(ev.file.amount).eq(dec(o.amount))) {
        at(`outcome ${o.id} is ${o.level} but its evidence does not support it`);
      }
    }
  }

  // Quotes are evidence gathered BEFORE paying, against an estimate of this check.
  for (const q of c.quotes) {
    if (!c.estimates.some((e) => e.id === q.estimateId)) at(`quote ${q.id} refers to an unknown estimate`);
    if (c.choice && q.at > c.choice.at) at(`quote ${q.id} was added after the route was recorded`);
  }

  // Evidence never carries a beneficiary account: only these entered fields may be stored.
  const ENTERED = new Set(["amount", "date", "sendingBank", "receivingBank", "trackingKey"]);
  for (const e of c.evidence) {
    const extra = Object.keys(e.entered).filter((k) => !ENTERED.has(k));
    if (extra.length) at(`evidence ${e.id} stores fields that must not be kept: ${extra.join(", ")}`);
    if (e.file && Object.keys(e.file).some((k) => /account|cuenta|clabe/i.test(k))) at(`evidence ${e.id} stores an account from the receipt`);
  }

  // Unique IDs within each history.
  for (const [name, list] of [
    ["estimate", c.estimates],
    ["event", c.events],
    ["outcome", c.outcomes],
    ["evidence", c.evidence],
    ["quote", c.quotes],
  ] as const) {
    const ids = (list as { id: string }[]).map((x) => x.id);
    if (new Set(ids).size !== ids.length) at(`duplicate ${name} IDs`);
  }
  return v;
}

export function databaseInvariants(db: Database): string[] {
  const v: string[] = [];
  const ids = db.checks.map((c) => c.id.toLowerCase());
  if (new Set(ids).size !== ids.length) v.push("duplicate check IDs");
  for (const c of db.checks) v.push(...checkInvariants(c));
  const versions = db.feeVersions.map((f) => f.version);
  if (new Set(versions).size !== versions.length) v.push("duplicate fee schedule versions");
  return v;
}

export function assertDatabaseInvariants(db: Database): void {
  const v = databaseInvariants(db);
  if (v.length) throw new InvariantError(v);
}
