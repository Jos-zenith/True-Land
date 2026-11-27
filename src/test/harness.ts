import crypto from "node:crypto";
import { getSql, insertWorkspace, setSqlClient, type Scope } from "@/server/db";
import { pgClient, pgliteClient, type SqlClient } from "@/server/store/sql";
import { buildSeed, DEFAULT_OWNER, DEFAULT_PERSONA } from "@/server/seed";
import { newWorkspaceKey } from "@/server/pseudonym";
import { signup } from "@/server/auth/accounts";
import { createSession, cookieName } from "@/server/auth/session";

/**
 * Test database. Default: PGlite (real PostgreSQL 17+ compiled to WASM, in-process, single connection).
 * With TEST_DATABASE_URL=postgres://… each test file gets its own schema on a real server, which also
 * exercises true multi-connection concurrency (row locks across connections).
 */
export async function freshDatabase(): Promise<SqlClient> {
  const url = process.env.TEST_DATABASE_URL;
  let client: SqlClient;
  if (url) {
    const schema = `t_${crypto.randomBytes(6).toString("hex")}`;
    const admin = await pgClient(url);
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.close();
    client = await pgClient(url, { searchPath: schema });
  } else {
    client = await pgliteClient(undefined);
  }
  await setSqlClient(client);
  return client;
}

export const realPostgres = () => !!process.env.TEST_DATABASE_URL;

/** Insert the classic Northstar seed (ws_northstar, u_alex, u_sam) with fixed time T. */
export async function seedNorthstar(T: number): Promise<{ scope: Scope; key: string }> {
  const sql = await getSql();
  const key = newWorkspaceKey();
  await sql.transaction(async (tx) => {
    for (const p of [DEFAULT_OWNER, DEFAULT_PERSONA]) {
      await tx.query("INSERT INTO users (id, email, name, initials, password_hash) VALUES ($1, $2, $3, $4, NULL)", [p.id, `${p.id}@example.test`, p.name, p.initials]);
    }
    await insertWorkspace(tx, buildSeed(T, { pseudonymKey: key }), key);
    await tx.query("INSERT INTO memberships (workspace_id, user_id, access, title, created_at) VALUES ('ws_northstar', 'u_alex', 'admin', 'AP clerk', $1)", [new Date(T).toISOString()]);
    await tx.query("INSERT INTO memberships (workspace_id, user_id, access, title, created_at) VALUES ('ws_northstar', 'u_sam', 'admin', 'Controller', $1)", [new Date(T + 1).toISOString()]);
  });
  return { scope: { workspaceId: "ws_northstar", userId: "u_alex" }, key };
}

export interface Tenant {
  userId: string;
  workspaceId: string;
  scope: Scope;
  token: string;
  cookie: string;
  email: string;
}

let n = 0;
export async function newTenant(label = "t", nowMs = Date.now()): Promise<Tenant> {
  n += 1;
  const email = `${label}-${n}-${crypto.randomBytes(3).toString("hex")}@example.test`;
  const { userId, workspaceId } = await signup({ email, password: "correct horse battery", name: `${label} Owner`, workspaceName: `${label} Workspace` }, nowMs);
  const token = await createSession(userId, workspaceId, nowMs);
  return { userId, workspaceId, scope: { workspaceId, userId }, token, cookie: `${cookieName()}=${token}`, email };
}

export async function sessionFor(userId: string, workspaceId: string): Promise<string> {
  const token = await createSession(userId, workspaceId, Date.now());
  return `${cookieName()}=${token}`;
}

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Invoke a Next.js route handler directly, as the framework would. */
export async function call(
  handler: unknown,
  opts: { method?: string; path?: string; body?: unknown; cookie?: string | null; params?: Record<string, string>; origin?: string | null; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: any; text: string; headers: Headers }> {
  const method = opts.method ?? "GET";
  const headers = new Headers({ host: "landed.test", ...opts.headers });
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (method !== "GET" && opts.origin !== null) headers.set("origin", opts.origin ?? "https://landed.test");
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  const req = new Request(`https://landed.test${opts.path ?? "/api/x"}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const res = await (handler as Handler)(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* CSV and other bodies */
  }
  return { status: res.status, json, text, headers: res.headers };
}
