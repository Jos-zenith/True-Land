import crypto from "node:crypto";
import { getSql } from "../db";
import type { Access } from "../model";

/**
 * Sessions: an opaque 256-bit random token in an HttpOnly, SameSite=Lax cookie (Secure and
 * "__Host-" prefixed in production). Only SHA-256(token) is stored, so a database read does not
 * yield usable sessions. Membership is re-checked on every request: removing a member, or revoking a
 * session, takes effect immediately.
 */
export const SESSION_TTL_MS = 12 * 3_600_000;

export function cookieName(env: NodeJS.ProcessEnv = process.env): string {
  return env.NODE_ENV === "production" ? "__Host-landed_session" : "landed_session";
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function sessionCookie(token: string, maxAgeSec: number, env: NodeJS.ProcessEnv = process.env): string {
  const secure = env.NODE_ENV === "production";
  return [`${cookieName(env)}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`, secure ? "Secure" : null].filter(Boolean).join("; ");
}

export function clearCookie(env: NodeJS.ProcessEnv = process.env): string {
  return sessionCookie("", 0, env);
}

export function readCookie(req: Request, name = cookieName()): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null;
    }
  }
  return null;
}

export async function createSession(userId: string, workspaceId: string, nowMs: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const sql = await getSql();
  await sql.query("INSERT INTO sessions (token_hash, user_id, workspace_id, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)", [
    hashToken(token),
    userId,
    workspaceId,
    new Date(nowMs).toISOString(),
    new Date(nowMs + SESSION_TTL_MS).toISOString(),
  ]);
  return token;
}

export interface SessionInfo {
  userId: string;
  workspaceId: string;
  access: Access;
}

export async function resolveSession(token: string | null, nowMs: number): Promise<SessionInfo | null> {
  if (!token) return null;
  const sql = await getSql();
  const r = await sql.query<{ user_id: string; workspace_id: string; access: Access }>(
    `SELECT s.user_id, s.workspace_id, m.access FROM sessions s
       JOIN memberships m ON m.workspace_id = s.workspace_id AND m.user_id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`,
    [hashToken(token), new Date(nowMs).toISOString()],
  );
  const row = r.rows[0];
  return row ? { userId: row.user_id, workspaceId: row.workspace_id, access: row.access } : null;
}

export async function revokeSession(token: string | null, nowMs: number): Promise<void> {
  if (!token) return;
  const sql = await getSql();
  await sql.query("UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL", [hashToken(token), new Date(nowMs).toISOString()]);
}
