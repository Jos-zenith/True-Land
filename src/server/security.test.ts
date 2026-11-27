/// <reference types="vite/client" />
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import crypto from "node:crypto";
import { call, freshDatabase, newTenant, type Tenant } from "@/test/harness";
import { getSql, readDb } from "./db";
import { can, MATRIX, type Permission } from "./auth/authz";
import { createSession, cookieName, sessionCookie, hashToken } from "./auth/session";
import { LOGIN_MAX_FAILURES } from "./auth/accounts";
import { supplierToken } from "@/lib/pseudonym";
import { csvCell } from "@/lib/csv";
import { addDays, ymd } from "@/lib/format";
import type { SqlClient } from "./store/sql";

import * as checksRoute from "@/app/api/checks/route";
import * as checkRoute from "@/app/api/checks/[id]/route";
import * as actionRoute from "@/app/api/checks/[id]/[action]/route";
import * as exportRoute from "@/app/api/checks/[id]/export/route";
import * as feesRoute from "@/app/api/fees/route";
import * as publishRoute from "@/app/api/fees/publish/route";
import * as ratesRoute from "@/app/api/rates/route";
import * as resetRoute from "@/app/api/demo/reset/route";
import * as membersRoute from "@/app/api/workspace/members/route";
import * as metaRoute from "@/app/api/meta/route";
import * as auditRoute from "@/app/api/audit/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as signupRoute from "@/app/api/auth/signup/route";
import * as logoutRoute from "@/app/api/auth/logout/route";

let sql: SqlClient;
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  sql = await freshDatabase();
  A = await newTenant("alpha");
  B = await newTenant("bravo");
});

afterEach(() => {
  delete process.env.LANDED_SIGNUP;
});

const PUBLIC = new Set(["/src/app/api/billing/stripe/webhook/route.ts", "/src/app/api/auth/login/route.ts", "/src/app/api/auth/signup/route.ts", "/src/app/api/auth/logout/route.ts", "/src/app/api/health/route.ts"]);
const ROUTES = import.meta.glob("/src/app/api/**/route.ts");

const newCheckBody = (t: Tenant, key: string, nickname = "Proveedora Secreta SA") => ({
  supplierToken: supplierToken(key, nickname),
  invoiceAmount: "255,000",
  invoiceCurrency: "MXN",
  sourceCountry: "US",
  destCountry: "MX",
  sourceCurrency: "USD",
  sendAmount: "15000",
  payBy: addDays(ymd(Date.now()), 4),
  payoutMethod: "spei_mxn",
  providers: ["bank_a", "fintech_b"],
  invoiceRef: null,
  chargeCode: "SHA",
});
const keyOf = async (t: Tenant) => (await call(metaRoute.GET, { cookie: t.cookie })).json.pseudonymKey as string;

async function addMember(admin: Tenant, access: "admin" | "member" | "viewer") {
  const email = `${access}-${crypto.randomBytes(3).toString("hex")}@example.test`;
  const r = await call(membersRoute.POST, { method: "POST", cookie: admin.cookie, body: { email, name: `${access} person`, title: "Clerk", password: "another long password", access } });
  expect(r.status).toBe(200);
  const login = await call(loginRoute.POST, { method: "POST", body: { email, password: "another long password" } });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  return { cookie, email };
}

describe("authentication", () => {
  it("every non-public API route refuses requests without a session (completeness check over all routes)", async () => {
    const files = Object.keys(ROUTES);
    expect(files.length).toBeGreaterThan(15);
    for (const file of files) {
      if (PUBLIC.has(file)) continue;
      const mod = (await ROUTES[file]()) as Record<string, unknown>;
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        if (typeof mod[method] !== "function") continue;
        const r = await call(mod[method], { method, params: { id: "CHK-014", action: "note" }, body: method === "GET" ? undefined : {} });
        expect(r.status, `${method} ${file}`).toBe(401);
        expect(r.json.error.code).toBe("UNAUTHENTICATED");
      }
    }
  });

  it("rejects forged, expired and revoked sessions", async () => {
    expect((await call(metaRoute.GET, { cookie: `${cookieName()}=${crypto.randomBytes(32).toString("base64url")}` })).status).toBe(401);
    const expired = await createSession(A.userId, A.workspaceId, Date.now() - 13 * 3_600_000);
    expect((await call(metaRoute.GET, { cookie: `${cookieName()}=${expired}` })).status).toBe(401);
    const s = await createSession(A.userId, A.workspaceId, Date.now());
    const cookie = `${cookieName()}=${s}`;
    expect((await call(metaRoute.GET, { cookie })).status).toBe(200);
    expect((await call(logoutRoute.POST, { method: "POST", cookie })).status).toBe(200);
    expect((await call(metaRoute.GET, { cookie })).status).toBe(401);
  });

  it("stores only hashed session tokens and scrypt password hashes", async () => {
    const token = A.token;
    const rows = (await sql.query<{ token_hash: string }>("SELECT token_hash FROM sessions")).rows.map((r) => r.token_hash);
    expect(rows).toContain(hashToken(token));
    expect(rows).not.toContain(token);
    const pw = (await sql.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = $1", [A.email])).rows[0].password_hash;
    expect(pw).toMatch(/^scrypt\$\d+\$8\$1\$/);
    expect(pw).not.toContain("correct horse battery");
  });

  it("session cookies are HttpOnly + SameSite=Lax, and Secure with the __Host- prefix in production", async () => {
    const r = await call(loginRoute.POST, { method: "POST", body: { email: A.email, password: "correct horse battery" } });
    const c = r.headers.get("set-cookie")!;
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
    const prod = sessionCookie("t", 60, { NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(prod).toMatch(/^__Host-landed_session=t;/);
    expect(prod).toMatch(/; Secure/);
    expect(prod).toMatch(/Path=\//);
  });

  it("gives the same answer for a wrong password and an unknown email, then rate-limits", async () => {
    const wrong = await call(loginRoute.POST, { method: "POST", body: { email: B.email, password: "wrong password here" } });
    const unknown = await call(loginRoute.POST, { method: "POST", body: { email: "nobody@example.test", password: "wrong password here" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.error.message).toBe(unknown.json.error.message);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await call(loginRoute.POST, { method: "POST", body: { email: B.email, password: "still wrong!!" } });
    const limited = await call(loginRoute.POST, { method: "POST", body: { email: B.email, password: "correct horse battery" } });
    expect(limited.status).toBe(429);
  });

  it("sign-up can be closed by configuration", async () => {
    process.env.LANDED_SIGNUP = "closed";
    const r = await call(signupRoute.POST, { method: "POST", body: { email: "new@example.test", password: "a long enough pw", name: "New Person", workspaceName: "New Co" } });
    expect(r.status).toBe(403);
  });

  it("rejects duplicate sign-up and weak passwords", async () => {
    expect((await call(signupRoute.POST, { method: "POST", body: { email: A.email, password: "a long enough pw", name: "X Y", workspaceName: "X Co" } })).status).toBe(409);
    expect((await call(signupRoute.POST, { method: "POST", body: { email: "weak@example.test", password: "short", name: "X Y", workspaceName: "X Co" } })).status).toBe(422);
  });
});

describe("tenant isolation", () => {
  let created = "";

  it("a check created in workspace A is invisible and immutable from workspace B", async () => {
    const r = await call(checksRoute.POST, { method: "POST", cookie: A.cookie, body: newCheckBody(A, await keyOf(A)) });
    expect(r.status).toBe(200);
    created = r.json.id;
    expect(created).toBe("CHK-021");
    const asB = { cookie: B.cookie, params: { id: created } };
    expect((await call(checkRoute.GET, asB)).status).toBe(404);
    expect((await call(checkRoute.PATCH, { ...asB, method: "PATCH", body: { sendAmount: "1" } })).status).toBe(404);
    expect((await call(exportRoute.GET, asB)).status).toBe(404);
    for (const action of ["note", "archive", "duplicate", "recalculate"]) {
      const res = await call(actionRoute.POST, { method: "POST", cookie: B.cookie, params: { id: created, action }, body: { text: "x" } });
      expect(res.status, action).toBe(404);
    }
    const listB = (await call(checksRoute.GET, { cookie: B.cookie })).json.items.map((i: { id: string }) => i.id);
    expect(listB).not.toContain(created);
  });

  it("the same check ID in two workspaces refers to two different records", async () => {
    await call(actionRoute.POST, { method: "POST", cookie: A.cookie, params: { id: "CHK-014", action: "note" }, body: { text: "alpha-only note" } });
    const b = await call(checkRoute.GET, { cookie: B.cookie, params: { id: "CHK-014" } });
    expect(JSON.stringify(b.json)).not.toContain("alpha-only note");
  });

  it("members, audit log and supplier IDs never leak across workspaces", async () => {
    const membersB = (await call(membersRoute.GET, { cookie: B.cookie })).json.items;
    expect(JSON.stringify(membersB)).not.toContain(A.email);
    const auditB = (await call(auditRoute.GET, { cookie: B.cookie })).json.items;
    expect(JSON.stringify(auditB)).not.toContain("alpha-only note");
    const idsA = new Set((await readDb(A.scope)).checks.map((c) => c.supplierHash));
    const idsB = new Set((await readDb(B.scope)).checks.map((c) => c.supplierHash));
    for (const id of idsA) expect(idsB.has(id)).toBe(false); // same demo supplier names, unlinkable IDs
  });

  it("an admin cannot add a member to another workspace by naming it in the body", async () => {
    const r = await call(membersRoute.POST, { method: "POST", cookie: A.cookie, body: { email: "sneaky@example.test", name: "Sneaky One", title: "Clerk", password: "long enough password", access: "admin", workspaceId: B.workspaceId } });
    expect(r.status).toBe(200);
    const membersB = (await call(membersRoute.GET, { cookie: B.cookie })).json.items;
    expect(JSON.stringify(membersB)).not.toContain("sneaky@example.test");
  });
});

describe("authorization (server-side, by role)", () => {
  it("the permission matrix is what the product promises", () => {
    const allowed = (p: Permission) => (["admin", "member", "viewer"] as const).filter((a) => can(a, p));
    expect(allowed("read")).toEqual(["admin", "member", "viewer"]);
    expect(allowed("check:write")).toEqual(["admin", "member"]);
    expect(allowed("fees:write")).toEqual(["admin"]);
    expect(allowed("members:manage")).toEqual(["admin"]);
    expect(allowed("demo:reset")).toEqual(["admin"]);
    expect(Object.keys(MATRIX).sort()).toEqual(["check:export", "check:write", "demo:reset", "evidence:verify", "fees:write", "members:manage", "rates:write", "read"]);
  });

  it("a viewer can read and export but cannot change anything", async () => {
    const v = await addMember(A, "viewer");
    expect((await call(checksRoute.GET, { cookie: v.cookie })).status).toBe(200);
    expect((await call(exportRoute.GET, { cookie: v.cookie, params: { id: "CHK-014" } })).status).toBe(200);
    expect((await call(checksRoute.POST, { method: "POST", cookie: v.cookie, body: newCheckBody(A, await keyOf(A)) })).status).toBe(403);
    expect((await call(actionRoute.POST, { method: "POST", cookie: v.cookie, params: { id: "CHK-014", action: "note" }, body: { text: "x" } })).status).toBe(403);
    expect((await call(ratesRoute.POST, { method: "POST", cookie: v.cookie, body: { rate: "17.1", sourceNote: "bank screen" } })).status).toBe(403);
    expect((await call(checkRoute.GET, { cookie: v.cookie, params: { id: "CHK-014" } })).json.actions.canAddQuote).toBe(false);
  });

  it("a member can work checks but cannot change fee schedules, members or reset the demo", async () => {
    const m = await addMember(A, "member");
    expect((await call(actionRoute.POST, { method: "POST", cookie: m.cookie, params: { id: "CHK-014", action: "note" }, body: { text: "member note" } })).status).toBe(200);
    expect((await call(feesRoute.DELETE, { method: "DELETE", cookie: m.cookie })).status).toBe(403);
    expect((await call(publishRoute.POST, { method: "POST", cookie: m.cookie, body: { note: "sneaky change" } })).status).toBe(403);
    expect((await call(membersRoute.POST, { method: "POST", cookie: m.cookie, body: { email: "x@example.test", name: "X Y", title: "T T", password: "long enough password", access: "admin" } })).status).toBe(403);
    expect((await call(resetRoute.POST, { method: "POST", cookie: m.cookie })).status).toBe(403);
  });

  it("removing a membership revokes access immediately, even with a live session", async () => {
    const m = await addMember(A, "member");
    expect((await call(metaRoute.GET, { cookie: m.cookie })).status).toBe(200);
    await sql.query("DELETE FROM memberships WHERE user_id = (SELECT id FROM users WHERE email = $1)", [m.email]);
    expect((await call(metaRoute.GET, { cookie: m.cookie })).status).toBe(401);
  });

  it("an admin can reset its own demo workspace, and nobody can reset a real one", async () => {
    const t = await newTenant("resetter");
    expect((await call(resetRoute.POST, { method: "POST", cookie: t.cookie })).status).toBe(200);
    await sql.query("UPDATE workspaces SET is_demo = false WHERE id = $1", [t.workspaceId]);
    expect((await call(resetRoute.POST, { method: "POST", cookie: t.cookie })).status).toBe(403);
  });
});

describe("request hardening", () => {
  it("refuses cross-site mutations (CSRF) but allows same-origin ones", async () => {
    const body = { text: "csrf?" };
    const p = { id: "CHK-014", action: "note" };
    expect((await call(actionRoute.POST, { method: "POST", cookie: A.cookie, params: p, body, origin: "https://evil.example" })).status).toBe(403);
    expect((await call(actionRoute.POST, { method: "POST", cookie: A.cookie, params: p, body, origin: null })).status).toBe(403);
    expect((await call(actionRoute.POST, { method: "POST", cookie: A.cookie, params: p, body, origin: null, headers: { "sec-fetch-site": "same-origin" } })).status).toBe(200);
    expect((await call(loginRoute.POST, { method: "POST", body: { email: A.email, password: "x" }, origin: "https://evil.example" })).status).toBe(403);
  });

  it("requires JSON bodies and never leaks internals in errors", async () => {
    const res = await actionRoute.POST(
      new Request("https://landed.test/api/checks/CHK-014/note", { method: "POST", headers: { host: "landed.test", origin: "https://landed.test", cookie: A.cookie, "content-type": "text/plain" }, body: "text=hi" }),
      { params: Promise.resolve({ id: "CHK-014", action: "note" }) },
    );
    expect(res.status).toBe(415);
    const bad = await call(actionRoute.POST, { method: "POST", cookie: A.cookie, params: { id: "CHK-014", action: "quote" }, body: { kind: "amount", value: "1e9999", ruleId: "x" } });
    expect(bad.status).toBe(422);
    expect(bad.text).not.toMatch(/at \w+ \(|node_modules|\.ts:/);
  });

  it("CSV export neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-115")).toBe("-115");
  });
});

describe("privacy", () => {
  async function dump(): Promise<string> {
    const tables = ["workspaces", "users", "memberships", "sessions", "checks", "records", "audit_events", "login_attempts"];
    const out: string[] = [];
    for (const t of tables) out.push(JSON.stringify((await sql.query(`SELECT * FROM ${t}`)).rows));
    return out.join("\n");
  }

  it("the supplier nickname never reaches the server: only a token is sent, and neither is stored", async () => {
    const key = await keyOf(A);
    const body = newCheckBody(A, key, "Muy Secreto Proveedor");
    const r = await call(checksRoute.POST, { method: "POST", cookie: A.cookie, body });
    expect(r.status).toBe(200);
    expect(JSON.stringify(body)).not.toMatch(/secreto/i);
    const all = await dump();
    expect(all).not.toMatch(/muy secreto/i);
    expect(all).not.toContain(body.supplierToken); // the browser token is re-keyed, not stored
    expect(r.json.supplierId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("the beneficiary account is used for a receipt check and never stored, in any table", async () => {
    const clabe = "002010077777777771";
    const r = await call(actionRoute.POST, {
      method: "POST",
      cookie: A.cookie,
      params: { id: "CHK-009", action: "cep" },
      body: { mode: "demo", demo: "match", amount: "83900", date: ymd(Date.now() - 86_400_000), sendingBank: "B1", receivingBank: "B2", trackingKey: null, beneficiaryAccount: clabe },
    });
    expect(r.status).toBe(200);
    expect(r.json.evidence.mode).toBe("demo");
    expect(await dump()).not.toContain(clabe);
  });

  it("demo receipt checks are refused in a real workspace; live checks fail closed when not configured", async () => {
    const t = await newTenant("real");
    await sql.query("UPDATE workspaces SET is_demo = false WHERE id = $1", [t.workspaceId]);
    const base = { amount: "83900", date: ymd(Date.now()), sendingBank: "B1", receivingBank: "B2", trackingKey: "TRK" };
    const demo = await call(actionRoute.POST, { method: "POST", cookie: t.cookie, params: { id: "CHK-009", action: "cep" }, body: { ...base, mode: "demo", demo: "match" } });
    expect(demo.status).toBe(409);
    expect(demo.json.error.code).toBe("DEMO_ONLY");
    const liveRes = await call(actionRoute.POST, { method: "POST", cookie: t.cookie, params: { id: "CHK-009", action: "cep" }, body: { ...base, mode: "live" } });
    expect(liveRes.status).toBe(503);
    expect((await readDb(t.scope)).checks.find((c) => c.id === "CHK-009")!.evidence).toHaveLength(0);
  });

  it("the pseudonymisation key is only served to members of that workspace", async () => {
    expect(await keyOf(A)).not.toBe(await keyOf(B));
    expect((await call(metaRoute.GET, {})).status).toBe(401);
  });
});

describe("health", () => {
  it("reports database connectivity without configuration details", async () => {
    const { GET } = await import("@/app/api/health/route");
    const r = await call(GET, {});
    expect(r.status).toBe(200);
    const { MIGRATIONS } = await import("./store/migrations");
    expect(r.json).toEqual({ ok: true, db: (await getSql()).kind, schema: MIGRATIONS.at(-1)!.version });
  });
});
