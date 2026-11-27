import { describe, it, expect, beforeAll } from "vitest";
import { freshDatabase, realPostgres, seedNorthstar } from "@/test/harness";
import { mutate, readDb, insertWorkspace, type Scope } from "./db";
import { databaseInvariants } from "./invariants";
import { buildSeed } from "./seed";
import { newWorkspaceKey } from "./pseudonym";
import * as svc from "./services/checks";
import { verifyAuditChain } from "./store/audit";
import type { SqlClient } from "./store/sql";
import { addDays, ymd } from "@/lib/format";

/**
 * Concurrency. `mutate` takes SELECT … FOR UPDATE on the workspace row, so writers to one workspace
 * are serialised across connections and server instances; each sees the previous writer's result.
 *
 * NOTE: by default these run on PGlite, which has ONE connection and queues transactions, so they
 * prove "no lost updates / exactly-one-winner" through the store's code path but not cross-connection
 * row locking. Set TEST_DATABASE_URL to a real PostgreSQL to exercise true parallel connections
 * (the CI workflow does this).
 */
const T = Date.now();
let sql: SqlClient;
let scope: Scope;

beforeAll(async () => {
  sql = await freshDatabase();
  ({ scope } = await seedNorthstar(T - 60_000));
});

const ctx = () => ({ actor: "u_alex", nowMs: Date.now() });
const inputs = async () => (await readDb(scope)).checks.find((c) => c.id === "CHK-014")!.inputs;

describe(`concurrent writers (${realPostgres() ? "real PostgreSQL, multiple connections" : "PGlite, single connection"})`, () => {
  it("25 parallel check creations: no lost updates, unique sequential IDs, intact audit chain", async () => {
    const base = { ...(await inputs()), payBy: addDays(ymd(Date.now()), 4), supplierHash: "b".repeat(32), draft: false, quote: null };
    const before = (await readDb(scope)).checks.length;
    const created = await Promise.all(Array.from({ length: 25 }, () => mutate(scope, (db) => svc.createCheck(db, base, ctx()).id)));
    expect(new Set(created).size).toBe(25);
    const db = await readDb(scope);
    expect(db.checks.length).toBe(before + 25);
    const nums = created.map((id) => Number(id.slice(4))).sort((a, b) => a - b);
    expect(nums.at(-1)! - nums[0]).toBe(24); // contiguous: no counter reuse or gaps
    expect(databaseInvariants(db)).toEqual([]);
    expect((await sql.transaction((tx) => verifyAuditChain(tx, "ws_northstar"))).ok).toBe(true);
  });

  it("racing route choices on one check: exactly one wins, the rest are refused", async () => {
    const results = await Promise.allSettled(
      ["fintech_b_mxn", "bank_a_mxn", "fintech_b_mxn", "bank_a_mxn", "fintech_b_mxn"].map((optionId) =>
        mutate(scope, (db) => svc.recordChoice(db, "CHK-014", { optionId, paidOn: ymd(Date.now()), confirmStale: true }, ctx())),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(4);
    for (const r of refused) expect(r.reason).toMatchObject({ status: 409, code: "STATE" });
    const c = (await readDb(scope)).checks.find((x) => x.id === "CHK-014")!;
    expect(c.events.filter((e) => e.type === "route_selected")).toHaveLength(1);
  });

  it("racing outcomes (received vs no reply vs refused): exactly one is recorded", async () => {
    const today = ymd(Date.now());
    const results = await Promise.allSettled([
      mutate(scope, (db) => svc.recordOutcome(db, "CHK-012", { result: "received", amount: "168000", date: today, reportedBy: "supplier", level: "reported" }, ctx())),
      mutate(scope, (db) => svc.recordOutcome(db, "CHK-012", { result: "refused", date: today }, ctx())),
      mutate(scope, (db) => svc.recordOutcome(db, "CHK-012", { result: "received", amount: "168500", date: today, reportedBy: "supplier", level: "reported" }, ctx())),
    ]);
    const c = (await readDb(scope)).checks.find((x) => x.id === "CHK-012")!;
    // "refused" then "received" is not an allowed transition, nor is "reconciled" then anything.
    expect(c.outcomes).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(databaseInvariants(await readDb(scope))).toEqual([]);
  });

  it("parallel corrections append in order without losing any", async () => {
    const today = ymd(Date.now());
    await mutate(scope, (db) => svc.recordOutcome(db, "CHK-011", { result: "received", amount: "117000", date: today, reportedBy: "supplier", level: "reported" }, ctx()));
    const amounts = ["117001", "117002", "117003", "117004", "117005", "117006"];
    await Promise.all(amounts.map((amount) => mutate(scope, (db) => svc.correctOutcome(db, "CHK-011", { amount }, ctx()))));
    const c = (await readDb(scope)).checks.find((x) => x.id === "CHK-011")!;
    expect(c.outcomes).toHaveLength(1 + amounts.length);
    expect(new Set(c.outcomes.slice(1).map((o) => o.amount))).toEqual(new Set(amounts));
    // Each correction refers to the outcome that was current when it ran: a single linear chain.
    for (let i = 1; i < c.outcomes.length; i++) expect(c.outcomes[i].correctionOf).toBe(c.outcomes[i - 1].id);
  });

  it("writers in different workspaces do not block or affect each other", async () => {
    const ws2 = "ws_other";
    const k = newWorkspaceKey();
    await sql.transaction((tx) => insertWorkspace(tx, buildSeed(T, { workspaceId: ws2, pseudonymKey: k }), k));
    const s2 = { workspaceId: ws2, userId: "u_alex" };
    const before1 = (await readDb(scope)).checks.length;
    const base = { ...(await inputs()), payBy: addDays(ymd(Date.now()), 4), supplierHash: "c".repeat(32), draft: false, quote: null };
    await Promise.all([
      ...Array.from({ length: 5 }, () => mutate(scope, (db) => svc.createCheck(db, base, ctx()))),
      ...Array.from({ length: 5 }, () => mutate(s2, (db) => svc.createCheck(db, base, ctx()))),
    ]);
    expect((await readDb(scope)).checks.length).toBe(before1 + 5);
    expect((await readDb(s2)).checks.length).toBe(13 + 5);
    expect((await readDb(s2)).checks.map((c) => c.id)).toContain("CHK-021"); // independent counters
  });

  it("readers always see a consistent snapshot while writers run", async () => {
    const base = { ...(await inputs()), payBy: addDays(ymd(Date.now()), 4), supplierHash: "d".repeat(32), draft: false, quote: null };
    const writes = Array.from({ length: 10 }, () => mutate(scope, (db) => svc.createCheck(db, base, ctx())));
    const reads = Array.from({ length: 10 }, () => readDb(scope).then((db) => databaseInvariants(db)));
    const [, violations] = await Promise.all([Promise.all(writes), Promise.all(reads)]);
    for (const v of violations) expect(v).toEqual([]);
  });
});
