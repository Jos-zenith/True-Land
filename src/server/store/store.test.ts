import { describe, it, expect, beforeAll } from "vitest";
import { freshDatabase, seedNorthstar } from "@/test/harness";
import { getSql, insertWorkspace, mutate, readDb, resetDemoWorkspace, type Scope } from "../db";
import { buildSeed } from "../seed";
import { newWorkspaceKey } from "../pseudonym";
import { InvariantError } from "../invariants";
import * as svc from "../services/checks";
import { HistoryViolation } from "./aggregate";
import { verifyAuditChain } from "./audit";
import { MIGRATIONS, migrate } from "./migrations";
import type { SqlClient } from "./sql";

const T = new Date("2026-11-26T12:00:00Z").getTime();
let sql: SqlClient;
let scope: Scope;
let key: string;

beforeAll(async () => {
  sql = await freshDatabase();
  ({ scope, key } = await seedNorthstar(T));
});

const strip = <T,>(x: T) => JSON.parse(JSON.stringify(x));

describe("PostgreSQL persistence", () => {
  it("round-trips the whole aggregate exactly (checks, history, rates, schedules, config log, counters)", async () => {
    const expected = buildSeed(T, { pseudonymKey: key });
    const db = await readDb(scope);
    expect(strip(db.checks)).toEqual(strip(expected.checks));
    expect(strip(db.rates)).toEqual(strip(expected.rates));
    expect(strip(db.feeVersions)).toEqual(strip(expected.feeVersions));
    expect(strip(db.configEvents)).toEqual(strip(expected.configEvents));
    expect(db.counters).toEqual(expected.counters);
    expect(db.seededAt).toBe(expected.seededAt);
  });

  it("migrations are idempotent and recorded", async () => {
    await migrate(sql);
    const r = await sql.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
    expect(r.rows.map((x) => Number(x.version))).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it("an unknown workspace is not found", async () => {
    await expect(readDb({ workspaceId: "ws_nope", userId: "u_alex" })).rejects.toMatchObject({ status: 404 });
  });

  it("a failed mutation writes nothing", async () => {
    const before = await sql.query("SELECT count(*)::int n FROM audit_events");
    await expect(
      mutate(scope, (db) => {
        svc.addNote(db, "CHK-014", "should not persist", { actor: "u_alex", nowMs: T });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await sql.query("SELECT count(*)::int n FROM audit_events")).rows).toEqual(before.rows);
  });
});

describe("immutable history (application layer)", () => {
  const cases: [string, (db: Awaited<ReturnType<typeof readDb>>) => void][] = [
    ["editing an activity event", (db) => { db.checks[0].events[0].message = "rewritten"; }],
    ["removing an estimate", (db) => { db.checks.find((c) => c.id === "CHK-016")!.estimates.pop(); }],
    ["editing an outcome", (db) => { db.checks.find((c) => c.id === "CHK-009")!.outcomes[0].amount = "1"; }],
    ["editing evidence", (db) => { db.checks.find((c) => c.id === "CHK-010")!.evidence[0].result = "verified"; db.checks.find((c) => c.id === "CHK-010")!.evidence[0].detail = "x"; }],
    ["changing a recorded choice", (db) => { db.checks.find((c) => c.id === "CHK-011")!.choice!.paidOn = "2020-01-01"; }],
    ["deleting a check", (db) => { db.checks.splice(0, 1); }],
    ["editing a published fee schedule", (db) => { db.feeVersions[0].note = "rewritten"; }],
    ["editing the configuration log", (db) => { db.configEvents[0].message = "rewritten"; }],
    ["changing who created a check", (db) => { db.checks[0].createdBy = "u_sam"; }],
    ["moving ID counters backwards", (db) => { db.counters.id = 1; }],
  ];
  it.each(cases)("rejects %s and writes nothing", async (_n, corrupt) => {
    const before = strip(await readDb(scope));
    await expect(mutate(scope, corrupt)).rejects.toBeInstanceOf(HistoryViolation);
    expect(strip(await readDb(scope))).toEqual(before);
  });

  it("rejects a change that leaves the lifecycle inconsistent", async () => {
    await expect(mutate(scope, (db) => { db.checks.find((c) => c.id === "CHK-014")!.status = "reconciled"; })).rejects.toBeInstanceOf(InvariantError);
  });
});

describe("immutable history (database layer: triggers hold even if application code is bypassed)", () => {
  it.each([
    ["UPDATE a record", "UPDATE records SET doc = '{}'::jsonb WHERE workspace_id = 'ws_northstar'"],
    ["DELETE a record", "DELETE FROM records WHERE workspace_id = 'ws_northstar'"],
    ["TRUNCATE records", "TRUNCATE records"],
    ["UPDATE an audit event", "UPDATE audit_events SET message = 'x' WHERE workspace_id = 'ws_northstar'"],
    ["DELETE an audit event", "DELETE FROM audit_events WHERE workspace_id = 'ws_northstar'"],
    ["TRUNCATE the audit log", "TRUNCATE audit_events"],
    ["DELETE a check", "DELETE FROM checks WHERE workspace_id = 'ws_northstar'"],
    ["change a recorded choice", "UPDATE checks SET doc = jsonb_set(doc, '{choice,paidOn}', '\"2020-01-01\"') WHERE id = 'CHK-011'"],
    ["remove a recorded choice", "UPDATE checks SET doc = jsonb_set(doc, '{choice}', 'null') WHERE id = 'CHK-011'"],
  ])("refuses to %s", async (_n, stmt) => {
    await expect(sql.query(stmt)).rejects.toThrow(/append-only|frozen|cannot be deleted/);
  });

  it("allows mutable check fields to change (status, archived)", async () => {
    await sql.query("UPDATE checks SET doc = jsonb_set(doc, '{archived}', 'false') WHERE id = 'CHK-014'");
  });

  it("refuses a purge of a NON-demo workspace even when the purge flag is set", async () => {
    const real = buildSeed(T, { workspaceId: "ws_real", pseudonymKey: newWorkspaceKey() });
    real.workspace.isDemo = false;
    const k = newWorkspaceKey();
    await sql.transaction((tx) => insertWorkspace(tx, real, k));
    await expect(
      sql.transaction(async (tx) => {
        await tx.query("SELECT set_config('landed.purge_workspace', 'ws_real', true)");
        await tx.query("DELETE FROM audit_events WHERE workspace_id = 'ws_real'");
      }),
    ).rejects.toThrow(/append-only/);
    await expect(resetDemoWorkspace({ workspaceId: "ws_real", userId: "u_alex" }, () => real)).rejects.toMatchObject({ status: 403 });
  });
});

describe("tamper-evident audit chain", () => {
  it("verifies for a freshly seeded and mutated workspace", async () => {
    await mutate(scope, (db) => svc.addNote(db, "CHK-014", "chain me", { actor: "u_alex", nowMs: T + 1000 }));
    const report = await sql.transaction((tx) => verifyAuditChain(tx, "ws_northstar"));
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.count).toBeGreaterThan(40);
  });

  it("detects an edit made by someone who disabled the triggers (e.g. a superuser)", async () => {
    await sql.exec("ALTER TABLE audit_events DISABLE TRIGGER audit_append_only");
    try {
      await sql.query("UPDATE audit_events SET message = 'tampered' WHERE workspace_id = 'ws_northstar' AND seq = 5");
      const report = await sql.transaction((tx) => verifyAuditChain(tx, "ws_northstar"));
      expect(report.ok).toBe(false);
      expect(report.problems.join(" ")).toMatch(/seq 5: content does not match/);
    } finally {
      await sql.exec("ALTER TABLE audit_events ENABLE TRIGGER audit_append_only");
    }
  });

  it("detects a deleted tail event", async () => {
    const ws = "ws_tail";
    const k = newWorkspaceKey();
    await sql.transaction((tx) => insertWorkspace(tx, buildSeed(T, { workspaceId: ws, pseudonymKey: k }), k));
    await sql.exec("ALTER TABLE audit_events DISABLE TRIGGER audit_append_only");
    try {
      await sql.query(`DELETE FROM audit_events WHERE workspace_id = '${ws}' AND seq = (SELECT max(seq) FROM audit_events WHERE workspace_id = '${ws}')`);
    } finally {
      await sql.exec("ALTER TABLE audit_events ENABLE TRIGGER audit_append_only");
    }
    const report = await sql.transaction((tx) => verifyAuditChain(tx, ws));
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/head/);
  });
});

describe("demo reset", () => {
  it("purges and re-seeds a demo workspace, keeps the chain valid and logs the reset", async () => {
    const ws = "ws_demo_reset";
    const k = newWorkspaceKey();
    await sql.transaction((tx) => insertWorkspace(tx, buildSeed(T, { workspaceId: ws, pseudonymKey: k }), k));
    const s = { workspaceId: ws, userId: "u_alex" };
    await mutate(s, (db) => svc.addNote(db, "CHK-014", "will be purged", { actor: "u_alex", nowMs: T + 5 }));
    await resetDemoWorkspace(s, (key2) => buildSeed(T + 10_000, { workspaceId: ws, pseudonymKey: key2 }), T + 10_000);
    const db = await readDb(s);
    expect(db.checks).toHaveLength(13);
    expect(JSON.stringify(db)).not.toContain("will be purged");
    expect(db.configEvents.at(-1)?.type).toBe("demo_reset");
    expect((await getSql().then((c) => c.transaction((tx) => verifyAuditChain(tx, ws)))).ok).toBe(true);
  });
});
