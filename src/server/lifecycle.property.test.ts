import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { EngineError } from "@/engine";
import { addDays, ymd } from "@/lib/format";
import { ServiceError } from "./core";
import { canTransition, checkInvariants, databaseInvariants, InvariantError, assertDatabaseInvariants } from "./invariants";
import type { Check, Database } from "./model";
import { buildSeed } from "./seed";
import * as svc from "./services/checks";
import { demoVerify } from "./verification";

/**
 * Model-based property test of the check lifecycle. Random sequences of service commands run against
 * the seeded workspace exactly as the store runs them: on any error the aggregate is rolled back.
 * After every command:
 *  1. every database invariant holds;
 *  2. history is append-only (estimates, quotes, outcomes, evidence, plan changes, events);
 *  3. a recorded choice never changes;
 *  4. every status change is an allowed lifecycle transition.
 */
const T = new Date("2026-11-26T12:00:00Z").getTime();
const SEED = buildSeed(T);
const IDS = SEED.checks.map((c) => c.id);
const ACTOR = "u_alex";

const arb = {
  check: fc.oneof(fc.constantFrom(...IDS), fc.constant("CHK-021"), fc.constant("CHK-022")),
  amount: fc.constantFrom("253100", "253215", "202612", "83900", "14975", "1", "999999"),
  fixture: fc.constantFrom("match" as const, "mismatch" as const, "unreadable" as const),
};

type Cmd =
  | { k: "create"; draft: boolean; send: string }
  | { k: "quote"; id: string; value: string }
  | { k: "choose"; id: string; option: string; stale: boolean }
  | { k: "received"; id: string; amount: string; useEvidence: boolean }
  | { k: "no_reply"; id: string }
  | { k: "refused"; id: string }
  | { k: "correct"; id: string; amount: string }
  | { k: "cep"; id: string; amount: string; fixture: "match" | "mismatch" | "unreadable" }
  | { k: "live_cep"; id: string; amount: string }
  | { k: "plan"; id: string }
  | { k: "archive"; id: string; on: boolean }
  | { k: "recalc"; id: string }
  | { k: "edit"; id: string; send: string }
  | { k: "dup"; id: string }
  | { k: "note"; id: string };

const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ k: fc.constant("create" as const), draft: fc.boolean(), send: fc.constantFrom("15000", "5000", "50") }),
  // Biased toward checks where a quote can be valid (USD 15,000 peso checks), plus out-of-range values.
  fc.record({ k: fc.constant("quote" as const), id: fc.oneof(fc.constantFrom("CHK-013", "CHK-014", "CHK-021"), arb.check), value: fc.constantFrom("253400", "253000", "15000") }),
  fc.record({ k: fc.constant("choose" as const), id: arb.check, option: fc.constantFrom("fintech_b_mxn", "bank_a_mxn", "nope"), stale: fc.boolean() }),
  fc.record({ k: fc.constant("received" as const), id: fc.oneof(fc.constantFrom("CHK-011", "CHK-012"), arb.check), amount: arb.amount, useEvidence: fc.boolean() }),
  fc.record({ k: fc.constant("no_reply" as const), id: fc.oneof(fc.constantFrom("CHK-011", "CHK-012"), arb.check) }),
  fc.record({ k: fc.constant("refused" as const), id: fc.oneof(fc.constantFrom("CHK-011", "CHK-012"), arb.check) }),
  // State-dependent commands are biased toward checks already in a state where they can apply.
  fc.record({ k: fc.constant("correct" as const), id: fc.oneof(fc.constantFrom("CHK-009", "CHK-010"), arb.check), amount: arb.amount }),
  fc.record({ k: fc.constant("cep" as const), id: fc.oneof(fc.constantFrom("CHK-009", "CHK-010", "CHK-011", "CHK-012"), arb.check), amount: arb.amount, fixture: arb.fixture }),
  fc.record({ k: fc.constant("live_cep" as const), id: fc.oneof(fc.constantFrom("CHK-009", "CHK-010", "CHK-011", "CHK-012"), arb.check), amount: arb.amount }),
  fc.record({ k: fc.constant("plan" as const), id: arb.check }),
  fc.record({ k: fc.constant("archive" as const), id: arb.check, on: fc.boolean() }),
  fc.record({ k: fc.constant("recalc" as const), id: arb.check }),
  fc.record({ k: fc.constant("edit" as const), id: arb.check, send: fc.constantFrom("16000", "4000") }),
  fc.record({ k: fc.constant("dup" as const), id: arb.check }),
  fc.record({ k: fc.constant("note" as const), id: arb.check }),
);

function run(db: Database, c: Cmd, nowMs: number) {
  const ctx = { actor: ACTOR, nowMs };
  const today = ymd(nowMs);
  const base = { amount: "", date: today, sendingBank: "Sample bank 1", receivingBank: "Sample bank 2", trackingKey: "KEY1" };
  switch (c.k) {
    case "create":
      return svc.createCheck(db, { ...SEED.checks[6].inputs, sendAmount: c.send, payBy: addDays(today, 4), supplierHash: "a".repeat(32), draft: c.draft, quote: null }, ctx);
    case "quote":
      return svc.addQuote(db, c.id, { ruleId: "fintech_b_mxn", kind: "amount", value: c.value }, ctx);
    case "choose":
      return svc.recordChoice(db, c.id, { optionId: c.option, paidOn: today, confirmStale: c.stale }, ctx);
    case "received": {
      const ev = c.useEvidence ? (db.checks.find((x) => x.id === c.id)?.evidence.at(-1)?.id ?? null) : null;
      return svc.recordOutcome(db, c.id, { result: "received", amount: c.amount, date: today, reportedBy: "supplier", level: "reported", evidenceId: ev }, ctx);
    }
    case "no_reply":
      return svc.recordOutcome(db, c.id, { result: "no_reply", date: today }, ctx);
    case "refused":
      return svc.recordOutcome(db, c.id, { result: "refused", date: today }, ctx);
    case "correct":
      return svc.correctOutcome(db, c.id, { amount: c.amount }, ctx);
    case "cep":
      return svc.validateCep(db, c.id, { ...base, amount: c.amount, demo: c.fixture }, ctx);
    case "live_cep": {
      // A stand-in for an authenticated live provider answer that matches the claim.
      const r = { ...demoVerify({ ...base, amount: c.amount, beneficiaryAccount: null }, "match", c.id), mode: "live" as const, provider: "remote:test", demo: null, providerRef: "REF" };
      return svc.recordReceiptCheck(db, c.id, { ...base, amount: c.amount }, r, ctx);
    }
    case "plan":
      return svc.recordPlanChange(db, c.id, "nothing", ctx);
    case "archive":
      return svc.setArchived(db, c.id, c.on, ctx);
    case "recalc":
      return svc.recalculate(db, c.id, ctx);
    case "edit":
      return svc.updateInputs(db, c.id, { sendAmount: c.send }, ctx);
    case "dup":
      return svc.duplicateCheck(db, c.id, ctx);
    case "note":
      return svc.addNote(db, c.id, "property test note", ctx);
  }
}

const ARRAYS = ["estimates", "quotes", "outcomes", "evidence", "planChanges", "events"] as const;

function assertHistoryPreserved(before: Database, after: Database) {
  for (const b of before.checks) {
    const a = after.checks.find((x) => x.id === b.id);
    expect(a, `${b.id} must not disappear`).toBeDefined();
    for (const k of ARRAYS) {
      const was = b[k] as unknown[];
      const now = a![k] as unknown[];
      expect(now.length).toBeGreaterThanOrEqual(was.length);
      expect(JSON.stringify(now.slice(0, was.length))).toBe(JSON.stringify(was));
    }
    if (b.choice) expect(JSON.stringify(a!.choice)).toBe(JSON.stringify(b.choice));
    expect(b.status === a!.status || canTransition(b.status, a!.status)).toBe(true);
  }
}

describe("lifecycle (model-based property test)", () => {
  it("the seed itself satisfies every invariant", () => {
    expect(databaseInvariants(SEED)).toEqual([]);
  });

  it("random command sequences never break invariants, history or the state machine", () => {
    const succeeded = new Map<string, number>();
    fc.assert(
      fc.property(fc.array(cmd, { minLength: 1, maxLength: 30 }), (cmds) => {
        let db = structuredClone(SEED);
        let now = T + 60_000;
        for (const c of cmds) {
          now += 60_000;
          const before = structuredClone(db);
          try {
            run(db, c, now);
            assertDatabaseInvariants(db); // the store runs this before committing
          } catch (e) {
            if (!(e instanceof ServiceError || e instanceof EngineError || e instanceof InvariantError)) throw e;
            // The store rolls back the whole transaction on any error. An InvariantError here would mean
            // a service produced an inconsistent state that only the store's safety net caught: fail.
            expect(e).not.toBeInstanceOf(InvariantError);
            db = before;
            continue;
          }
          assertHistoryPreserved(before, db);
          succeeded.set(c.k, (succeeded.get(c.k) ?? 0) + 1);
        }
      }),
      { numRuns: 150 },
    );
    // Guard against a vacuous property: the interesting transitions must actually have happened.
    for (const k of ["create", "quote", "choose", "received", "no_reply", "refused", "correct", "cep", "live_cep", "plan", "archive", "recalc", "edit", "dup"]) {
      expect(succeeded.get(k) ?? 0, `command "${k}" never succeeded`).toBeGreaterThan(0);
    }
  });

  it("a demo receipt can never make an outcome 'verified'; only a live one can", () => {
    fc.assert(
      fc.property(fc.array(cmd, { maxLength: 30 }), (cmds) => {
        let db = structuredClone(SEED);
        let now = T + 60_000;
        for (const c of cmds) {
          now += 60_000;
          const before = structuredClone(db);
          try {
            run(db, c, now);
          } catch {
            db = before;
          }
        }
        for (const ch of db.checks) {
          for (const o of ch.outcomes) {
            if (o.level === "verified") expect(ch.evidence.find((e) => e.id === o.evidenceId)?.mode).toBe("live");
            if (o.level === "demo_verified") expect(ch.evidence.find((e) => e.id === o.evidenceId)?.mode).toBe("demo");
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("invariant checker detects corrupted states", () => {
  const fresh = () => structuredClone(SEED);
  const find = (db: Database, id: string) => db.checks.find((c) => c.id === id) as Check;

  it.each([
    ["status awaiting without a choice", (db: Database) => { find(db, "CHK-014").status = "awaiting_receipt"; }, /inconsistent with no choice/],
    ["reconciled without an outcome", (db: Database) => { const c = find(db, "CHK-011"); c.status = "reconciled"; }, /reconciled without a received outcome/],
    ["verified level backed by demo evidence", (db: Database) => { const c = find(db, "CHK-010"); c.outcomes.at(-1)!.level = "verified"; }, /evidence does not support it/],
    ["verified without evidence", (db: Database) => { const c = find(db, "CHK-009"); c.outcomes.at(-1)!.level = "verified"; }, /without evidence/],
    ["quote added after the choice", (db: Database) => { const c = find(db, "CHK-010"); c.quotes[0].at = "2999-01-01T00:00:00.000Z"; }, /after the route was recorded/],
    ["account number stored in evidence", (db: Database) => { const c = find(db, "CHK-010"); (c.evidence[0].entered as Record<string, unknown>).beneficiaryAccount = "002010077777777771"; }, /must not be kept/],
    ["choice pointing at a missing estimate", (db: Database) => { find(db, "CHK-011").choice!.estimateId = "est_missing"; }, /estimate that does not exist/],
    ["correction of a later outcome", (db: Database) => { const c = find(db, "CHK-009"); c.outcomes[0].correctionOf = "out_zzz"; }, /not earlier/],
    ["duplicate check IDs", (db: Database) => { db.checks.push(structuredClone(find(db, "CHK-014"))); }, /duplicate check IDs/],
  ])("%s", (_name, corrupt, msg) => {
    const db = fresh();
    corrupt(db);
    expect(databaseInvariants(db).join("\n")).toMatch(msg);
    expect(() => assertDatabaseInvariants(db)).toThrow(InvariantError);
  });

  it("every check in the seed is individually consistent", () => {
    for (const c of SEED.checks) expect(checkInvariants(c)).toEqual([]);
  });
});
