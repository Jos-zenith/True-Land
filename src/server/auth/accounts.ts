import crypto from "node:crypto";
import { getSql, insertWorkspace } from "../db";
import { ServiceError } from "../core";
import type { Access } from "../model";
import { newWorkspaceKey } from "../pseudonym";
import { buildSeed, type SeedPerson } from "../seed";
import { hashPassword, verifyPassword } from "./password";

const rid = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString("base64url").replace(/[-_]/g, "x").toLowerCase()}`;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function signupAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LANDED_SIGNUP !== "closed";
}

/**
 * Create a user and their own workspace, pre-filled with the labelled sample data (the product has no
 * live provider data, so a workspace without the sample fee schedule could not estimate anything).
 * A sign-in-less "controller" persona is created to own part of the sample history.
 */
export async function signup(body: { email: string; password: string; name: string; workspaceName: string }, nowMs: number) {
  if (!signupAllowed()) throw new ServiceError(403, "SIGNUP_CLOSED", "Sign-up is closed on this deployment. Ask an administrator to add you.");
  const sql = await getSql();
  const email = body.email.trim().toLowerCase();
  const passwordHash = await hashPassword(body.password);
  const owner: SeedPerson = { id: rid("u"), name: body.name.trim(), initials: initialsOf(body.name), title: "AP clerk" };
  const persona: SeedPerson = { id: rid("u"), name: "Sam Okafor (sample)", initials: "SO", title: "Controller" };
  const workspaceId = rid("ws");
  const key = newWorkspaceKey();
  return sql.transaction(async (tx) => {
    const exists = await tx.query("SELECT 1 FROM users WHERE email = $1", [email]);
    if (exists.rows.length) throw new ServiceError(409, "EMAIL_TAKEN", "An account with this email already exists. Sign in instead.", { email: "Already registered." });
    await tx.query("INSERT INTO users (id, email, name, initials, password_hash) VALUES ($1, $2, $3, $4, $5)", [owner.id, email, owner.name, owner.initials, passwordHash]);
    await tx.query("INSERT INTO users (id, email, name, initials, password_hash) VALUES ($1, NULL, $2, $3, NULL)", [persona.id, persona.name, persona.initials]);
    const db = buildSeed(nowMs, { workspaceId, workspaceName: body.workspaceName.trim(), pseudonymKey: key, owner, persona });
    await insertWorkspace(tx, db, key);
    await tx.query("INSERT INTO memberships (workspace_id, user_id, access, title, created_at) VALUES ($1, $2, 'admin', $3, $4)", [workspaceId, owner.id, owner.title, new Date(nowMs).toISOString()]);
    await tx.query("INSERT INTO memberships (workspace_id, user_id, access, title, created_at) VALUES ($1, $2, 'admin', $3, $4)", [workspaceId, persona.id, persona.title, new Date(nowMs + 1).toISOString()]);
    return { userId: owner.id, workspaceId };
  });
}

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_FAILURES = 10;

/** Email + password sign-in with a per-email failure limit. Errors never reveal whether the email exists. */
export async function login(body: { email: string; password: string }, nowMs: number) {
  const sql = await getSql();
  const email = body.email.trim().toLowerCase();
  const since = new Date(nowMs - LOGIN_WINDOW_MS).toISOString();
  const failures = await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM login_attempts WHERE email = $1 AND at > $2 AND NOT ok", [email, since]);
  if ((failures.rows[0]?.n ?? 0) >= LOGIN_MAX_FAILURES) {
    throw new ServiceError(429, "RATE_LIMITED", "Too many failed attempts. Wait 15 minutes and try again.");
  }
  const u = (await sql.query<{ id: string; password_hash: string | null }>("SELECT id, password_hash FROM users WHERE email = $1", [email])).rows[0];
  const ok = await verifyPassword(body.password, u?.password_hash ?? null);
  await sql.query("INSERT INTO login_attempts (email, at, ok) VALUES ($1, $2, $3)", [email, new Date(nowMs).toISOString(), ok]);
  if (!ok || !u) throw new ServiceError(401, "BAD_CREDENTIALS", "Email or password is incorrect.");
  const m = (await sql.query<{ workspace_id: string }>("SELECT workspace_id FROM memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1", [u.id])).rows[0];
  if (!m) throw new ServiceError(403, "NO_WORKSPACE", "Your account is not a member of any workspace.");
  return { userId: u.id, workspaceId: m.workspace_id };
}

export async function listMembers(workspaceId: string) {
  const sql = await getSql();
  const r = await sql.query<{ id: string; email: string | null; name: string; access: Access; title: string; can_sign_in: boolean }>(
    `SELECT u.id, u.email, u.name, m.access, m.title, (u.password_hash IS NOT NULL) AS can_sign_in
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 ORDER BY m.created_at`,
    [workspaceId],
  );
  return r.rows.map((x) => ({ id: x.id, email: x.email, name: x.name, access: x.access, title: x.title, canSignIn: x.can_sign_in }));
}

/** Administrator adds a member with an initial password (no email delivery in this release). */
export async function addMember(workspaceId: string, body: { email: string; name: string; password: string; access: Access; title: string }) {
  const sql = await getSql();
  const email = body.email.trim().toLowerCase();
  const passwordHash = await hashPassword(body.password);
  return sql.transaction(async (tx) => {
    if ((await tx.query("SELECT 1 FROM users WHERE email = $1", [email])).rows.length) {
      throw new ServiceError(409, "EMAIL_TAKEN", "An account with this email already exists.", { email: "Already registered." });
    }
    const id = rid("u");
    await tx.query("INSERT INTO users (id, email, name, initials, password_hash) VALUES ($1, $2, $3, $4, $5)", [id, email, body.name.trim(), initialsOf(body.name), passwordHash]);
    await tx.query("INSERT INTO memberships (workspace_id, user_id, access, title) VALUES ($1, $2, $3, $4)", [workspaceId, id, body.access, body.title.trim()]);
    return { id };
  });
}

/** Owner (earliest admin who can sign in) and persona, used to re-seed a demo workspace. */
export async function demoActors(workspaceId: string): Promise<{ owner: SeedPerson; persona: SeedPerson }> {
  const members = await listMembers(workspaceId);
  const sql = await getSql();
  const initials = async (id: string) => (await sql.query<{ initials: string }>("SELECT initials FROM users WHERE id = $1", [id])).rows[0]?.initials ?? "??";
  const o = members.find((m) => m.canSignIn && m.access === "admin") ?? members[0];
  const p = members.find((m) => !m.canSignIn) ?? o;
  return {
    owner: { id: o.id, name: o.name, initials: await initials(o.id), title: o.title },
    persona: { id: p.id, name: p.name, initials: await initials(p.id), title: p.title },
  };
}
