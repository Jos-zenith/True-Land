import crypto from "node:crypto";
import type { Tx } from "./sql";

/**
 * Tamper-evident audit log. Each workspace's audit events form a SHA-256 hash chain:
 *   hash_n = SHA-256(hash_{n-1} || "\n" || canonical(event_n))
 * The head (last hash and sequence number) is kept on the workspace row. Rows are append-only
 * (database triggers), and `verifyAuditChain` detects any edit, deletion or reordering that bypassed
 * them (for example by a superuser disabling the triggers).
 */
export interface AuditRow {
  seq: number;
  checkId: string | null;
  id: string;
  at: string; // ISO
  actor: string;
  type: string;
  message: string;
}

export function canonical(workspaceId: string, e: AuditRow): string {
  return JSON.stringify([workspaceId, e.seq, e.checkId, e.id, new Date(e.at).toISOString(), e.actor, e.type, e.message]);
}

export function chainHash(prev: string, workspaceId: string, e: AuditRow): string {
  return crypto.createHash("sha256").update(`${prev}\n${canonical(workspaceId, e)}`).digest("hex");
}

export async function appendAudit(tx: Tx, workspaceId: string, head: { seq: number; hash: string }, events: Omit<AuditRow, "seq">[]) {
  let { seq, hash } = head;
  for (const e of events) {
    const row: AuditRow = { ...e, seq: seq + 1 };
    const next = chainHash(hash, workspaceId, row);
    await tx.query(
      `INSERT INTO audit_events (workspace_id, seq, check_id, id, at, actor, type, message, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [workspaceId, row.seq, row.checkId, row.id, row.at, row.actor, row.type, row.message, hash, next],
    );
    seq = row.seq;
    hash = next;
  }
  return { seq, hash };
}

export interface ChainReport {
  ok: boolean;
  count: number;
  problems: string[];
}

export async function verifyAuditChain(tx: Tx, workspaceId: string): Promise<ChainReport> {
  const ws = (await tx.query<{ audit_seq: string; audit_head: string }>("SELECT audit_seq, audit_head FROM workspaces WHERE id = $1", [workspaceId])).rows[0];
  if (!ws) return { ok: false, count: 0, problems: ["workspace not found"] };
  const rows = (
    await tx.query<{ seq: string; check_id: string | null; id: string; at: Date | string; actor: string; type: string; message: string; prev_hash: string; hash: string }>(
      "SELECT seq, check_id, id, at, actor, type, message, prev_hash, hash FROM audit_events WHERE workspace_id = $1 ORDER BY seq",
      [workspaceId],
    )
  ).rows;
  const problems: string[] = [];
  let prev = "";
  let expectSeq = 1;
  for (const r of rows) {
    const seq = Number(r.seq);
    if (seq !== expectSeq) problems.push(`gap or reorder at seq ${seq} (expected ${expectSeq})`);
    if (r.prev_hash !== prev) problems.push(`seq ${seq}: previous-hash link broken`);
    const row: AuditRow = { seq, checkId: r.check_id, id: r.id, at: new Date(r.at).toISOString(), actor: r.actor, type: r.type, message: r.message };
    const h = chainHash(r.prev_hash, workspaceId, row);
    if (h !== r.hash) problems.push(`seq ${seq}: content does not match its hash`);
    prev = r.hash;
    expectSeq = seq + 1;
  }
  if (Number(ws.audit_seq) !== rows.length) problems.push(`head says ${ws.audit_seq} events, found ${rows.length}`);
  if (ws.audit_head !== prev) problems.push("head hash does not match the last event");
  return { ok: problems.length === 0, count: rows.length, problems };
}
