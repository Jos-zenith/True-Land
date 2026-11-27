import type { Database } from "./model";
import { assertDatabaseInvariants } from "./invariants";
import { emptyAggregate, loadAggregate, loadWorkspaceRow, persistDiff, type WorkspaceRow } from "./store/aggregate";
import { migrate } from "./store/migrations";
import { connectFromEnv, type SqlClient, type Tx } from "./store/sql";
import { ServiceError, iso, nextId } from "./core";

export { nextId };

/**
 * Persistence facade (PostgreSQL).
 *
 * The service layer is unchanged: services receive a `Database` aggregate and mutate it synchronously.
 * What changed is WHERE that aggregate comes from:
 *   - it is scoped to ONE workspace (the authenticated tenant) and one acting user;
 *   - `mutate` locks that workspace row (SELECT … FOR UPDATE), so mutations are serialised across all
 *     server instances, not only within one process;
 *   - after the service runs, lifecycle invariants are checked and the diff is written append-only.
 *     If anything throws, the transaction rolls back and nothing is written.
 */
export interface Scope {
  workspaceId: string;
  userId: string;
}

type G = typeof globalThis & { __landedSql?: Promise<SqlClient> };
const g = globalThis as G;

/** The process-wide client, created and migrated once. Tests may inject their own. */
export function getSql(): Promise<SqlClient> {
  if (!g.__landedSql) {
    g.__landedSql = connectFromEnv().then(async (c) => {
      await migrate(c);
      return c;
    });
    g.__landedSql.catch(() => {
      g.__landedSql = undefined; // allow a retry after a failed cold start
    });
  }
  return g.__landedSql;
}

export async function setSqlClient(client: SqlClient | null, opts: { migrate?: boolean } = {}): Promise<void> {
  if (client && opts.migrate !== false) await migrate(client);
  g.__landedSql = client ? Promise.resolve(client) : undefined;
}

function notFound(): never {
  throw new ServiceError(404, "NOT_FOUND", "Workspace not found.");
}

/** Read a consistent private copy of one workspace (repeatable-read snapshot). */
export async function readDb(scope: Scope): Promise<Database> {
  const sql = await getSql();
  return sql.transaction(
    async (tx) => {
      const ws = (await loadWorkspaceRow(tx, scope.workspaceId, false)) ?? notFound();
      return loadAggregate(tx, ws, scope.userId);
    },
    { readOnly: true },
  );
}

/**
 * Apply a synchronous change to one workspace and persist it.
 * Serialised per workspace across instances. If `fn` throws, nothing is written.
 */
export async function mutate<T>(scope: Scope, fn: (db: Database) => T): Promise<T> {
  const sql = await getSql();
  return sql.transaction(async (tx) => {
    const ws = (await loadWorkspaceRow(tx, scope.workspaceId, true)) ?? notFound();
    const db = await loadAggregate(tx, ws, scope.userId);
    const before = structuredClone(db);
    const result = fn(db);
    assertDatabaseInvariants(db);
    await persistDiff(tx, ws, before, db);
    return result;
  });
}

/** Insert a brand-new workspace aggregate (signup, tests). Caller provides the transaction. */
export async function insertWorkspace(tx: Tx, db: Database, pseudonymKey: string): Promise<void> {
  assertDatabaseInvariants(db);
  await tx.query(
    "INSERT INTO workspaces (id, name, is_demo, corridor, seeded_at, pseudonym_key) VALUES ($1, $2, $3, $4, $5, $6)",
    [db.workspace.id, db.workspace.name, db.workspace.isDemo, db.workspace.corridor, db.seededAt, pseudonymKey],
  );
  const ws = (await loadWorkspaceRow(tx, db.workspace.id, true))!;
  await persistDiff(tx, ws, emptyAggregate(db), db);
}

/**
 * Demo reset: purge a DEMO workspace's history and re-seed it. Refused for real workspaces, both here
 * and by the database triggers. Memberships and sessions are kept.
 */
export async function resetDemoWorkspace(scope: Scope, build: (pseudonymKey: string) => Database, nowMs = Date.now()): Promise<void> {
  const sql = await getSql();
  await sql.transaction(async (tx) => {
    const ws = (await loadWorkspaceRow(tx, scope.workspaceId, true)) ?? notFound();
    if (!ws.is_demo) throw new ServiceError(403, "FORBIDDEN", "Only demo workspaces can be reset.");
    await tx.query("SELECT set_config('landed.purge_workspace', $1, true)", [ws.id]);
    await tx.query("DELETE FROM audit_events WHERE workspace_id = $1", [ws.id]);
    await tx.query("DELETE FROM records WHERE workspace_id = $1", [ws.id]);
    await tx.query("DELETE FROM checks WHERE workspace_id = $1", [ws.id]);
    await tx.query("DELETE FROM provider_quotes WHERE workspace_id = $1", [ws.id]);
    await tx.query("SELECT set_config('landed.purge_workspace', '', true)");
    await tx.query("UPDATE workspaces SET check_counter = 0, id_counter = 0, audit_seq = 0, audit_head = '', fee_draft = NULL WHERE id = $1", [ws.id]);
    const fresh = build(ws.pseudonym_key);
    fresh.workspace = { ...fresh.workspace, id: ws.id, name: ws.name };
    fresh.configEvents.push({
      id: nextId(fresh, "cfg"),
      at: iso(nowMs),
      actor: scope.userId,
      type: "demo_reset",
      message: "Demo data reset to the original sample workspace. Earlier demo history was purged.",
    });
    assertDatabaseInvariants(fresh);
    const row: WorkspaceRow = { ...ws, check_counter: 0, id_counter: 0, audit_seq: 0, audit_head: "", fee_draft: null };
    await persistDiff(tx, row, emptyAggregate(fresh), fresh);
  });
}

export async function workspaceKey(workspaceId: string): Promise<string> {
  const sql = await getSql();
  const r = await sql.query<{ pseudonym_key: string }>("SELECT pseudonym_key FROM workspaces WHERE id = $1", [workspaceId]);
  return r.rows[0]?.pseudonym_key ?? notFound();
}
