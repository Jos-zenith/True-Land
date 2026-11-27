import { describe, it, expect, beforeAll } from "vitest";
import { freshDatabase, seedNorthstar } from "@/test/harness";
import { readDb, mutate, type Scope } from "./db";
import { ServiceError } from "./core";
import { supplierIdForNickname } from "./pseudonym";
import * as svc from "./services/checks";
import * as fees from "./services/fees";
import { checkDetail, inbox, listItem, overview } from "./views";
import { ymd, addDays } from "@/lib/format";

/**
 * Integration: the original lifecycle suite, now running through the PostgreSQL store
 * (load aggregate -> service -> invariants -> append-only persist).
 */
const T = new Date("2026-11-26T12:00:00").getTime();
const ALEX = "u_alex";
let scope: Scope;
let key: string;
const get = async (id: string) => (await readDb(scope)).checks.find((c) => c.id === id)!;

beforeAll(async () => {
  await freshDatabase();
  ({ scope, key } = await seedNorthstar(T));
});

describe("seed", () => {
  it("builds a coherent demo workspace", async () => {
    const db = await readDb(scope);
    expect(db.workspace.name).toBe("Northstar Imports");
    expect(db.checks.map((c) => c.id)).toEqual([
      "CHK-008", "CHK-009", "CHK-010", "CHK-011", "CHK-012", "CHK-013", "CHK-014",
      "CHK-015", "CHK-016", "CHK-017", "CHK-018", "CHK-019", "CHK-020",
    ]);
    expect(db.checks.every((c) => c.isDemo)).toBe(true);
    const byId = (id: string) => listItem(db, db.checks.find((c) => c.id === id)!, T);
    expect(byId("CHK-014").expected).toEqual({ value: "253215", currency: "MXN" });
    expect(byId("CHK-015").expected).toEqual({ value: "14975", currency: "USD" });
    expect(byId("CHK-009").insideRange).toBe(false);
    expect(byId("CHK-009").ourError).toBe("-505");
    // Seeded with a DEMO receipt file: labelled demo, never plain "verified".
    expect(byId("CHK-010").evidence).toBe("demo_verified");
    expect(byId("CHK-010").ourError).toBe("40");
    expect(byId("CHK-011").replyOverdue).toBe(true);
    expect(byId("CHK-013").attention).toContain("Stale rate");
    expect(byId("CHK-019").group).toBe("calc_failed");
    expect(byId("CHK-020").status).toBe("draft");
  });

  it("covers every comparison state", async () => {
    const db = await readDb(scope);
    const verdict = (id: string) => checkDetail(db, db.checks.find((c) => c.id === id)!, T).estimate?.verdict.kind;
    expect(verdict("CHK-014")).toBe("favoured");
    expect(verdict("CHK-015")).toBe("cover");
    expect(verdict("CHK-016")).toBe("too_close");
    expect(verdict("CHK-017")).toBe("none_eligible");
    expect(verdict("CHK-018")).toBe("unrankable");
    const stale = checkDetail(db, db.checks.find((c) => c.id === "CHK-013")!, T);
    expect(stale.estimate?.rateStale).toBe(true);
    expect(stale.estimate?.excluded.some((e) => e.code === "eligibility_unverified")).toBe(true);
    const failed = checkDetail(db, db.checks.find((c) => c.id === "CHK-019")!, T);
    expect(failed.estimate).toBeNull(); // no amounts on an engine error
  });

  it("inbox surfaces work that needs attention", async () => {
    const kinds = inbox(await readDb(scope), T).map((i) => `${i.checkId}:${i.kind}`);
    expect(kinds).toEqual(expect.arrayContaining([
      "CHK-011:Reply overdue", "CHK-013:Stale rate", "CHK-019:Failed calculation", "CHK-020:Draft",
      "CHK-009:Unusual variance", "CHK-018:Incomplete evidence", "CHK-017:No eligible route",
    ]));
  });

  it("overview metrics come from the data", async () => {
    const o = overview(await readDb(scope), T);
    expect(o.metrics.total).toBe(13);
    expect(o.metrics.awaitingOutcome).toBe(2);
    expect(o.metrics.reconciled).toBe(2);
    expect(o.metrics.insideRange).toBe(1);
  });
});

describe("judge journey: create → quote → choose → outcome → reconcile → audit", () => {
  let id = "";
  const now = T + 60_000;
  const ctx = { actor: ALEX, nowMs: now };

  it("creates a $15,000 USD → MXN check and estimates it", async () => {
    const c = await mutate(scope, (db) =>
      svc.createCheck(db, {
        supplierHash: supplierIdForNickname("ws_northstar", key, "Supplier Z"),
        invoiceAmount: "255000", invoiceCurrency: "MXN", sourceCountry: "US", destCountry: "MX", sourceCurrency: "USD",
        sendAmount: "15000", payBy: addDays(ymd(now), 4), payoutMethod: "spei_mxn", providers: ["bank_a", "fintech_b"],
        invoiceRef: null, chargeCode: "SHA", draft: false, quote: null,
      }, ctx),
    );
    id = c.id;
    expect(id).toBe("CHK-021");
    expect(c.status).toBe("choose_route");
    expect(c.estimates).toHaveLength(1);
  });

  it("rejects a pay-by date in the past", async () => {
    const inputs = (await get(id)).inputs;
    await expect(
      mutate(scope, (db) => svc.createCheck(db, { ...inputs, payBy: "2026-11-20", supplierHash: "abcdef", draft: false, quote: null }, ctx)),
    ).rejects.toThrow(ServiceError);
  });

  it("records a provider quote and analyses it against the estimate", async () => {
    await mutate(scope, (db) => svc.addQuote(db, id, { ruleId: "fintech_b_mxn", kind: "amount", value: "253400" }, ctx));
    const db = await readDb(scope);
    const d = checkDetail(db, db.checks.find((c) => c.id === id)!, now);
    expect(d.quotes[0].analysis?.diffFromTypical).toBe("185");
    expect(d.quotes[0].sentence).toContain("MXN 185 above our typical, inside our range");
  });

  it("rejects a quote that is obviously in the wrong currency", async () => {
    await expect(mutate(scope, (db) => svc.addQuote(db, id, { ruleId: "fintech_b_mxn", kind: "amount", value: "15000" }, ctx))).rejects.toThrow(/20%/);
  });

  it("records the choice and freezes a snapshot", async () => {
    await mutate(scope, (db) => svc.recordChoice(db, id, { optionId: "fintech_b_mxn", paidOn: ymd(now), confirmStale: false }, ctx));
    const c = await get(id);
    expect(c.status).toBe("awaiting_receipt");
    expect(c.choice?.snapshot).toMatchObject({ typical: "253215", low: "252960", high: "253470", quote: "253400" });
    await expect(mutate(scope, (db) => svc.updateInputs(db, id, { sendAmount: "16000" }, ctx))).rejects.toThrow(/locked/);
  });

  it("publishing a new fee schedule never changes the saved estimate", async () => {
    const before = JSON.stringify((await get(id)).estimates);
    await mutate(scope, (db) => {
      const d = fees.getDraft(db);
      const rules = d.rules.map((r) => (r.id === "fintech_b_mxn" ? { ...r, markupPct: { low: "1.0", typical: "0.9", high: "0.8" } } : r));
      fees.saveDraft(db, rules, ctx);
      fees.publishDraft(db, "Test: Fintech B markup up", ctx);
    });
    expect((await readDb(scope)).feeVersions.at(-1)?.version).toBe(5);
    expect(JSON.stringify((await get(id)).estimates)).toBe(before);
  });

  it("supplier-reported outcome is Reported, never Verified", async () => {
    await mutate(scope, (db) => svc.recordOutcome(db, id, { result: "received", amount: "253100", date: ymd(now), reportedBy: "supplier", level: "reported", reference: null }, ctx));
    const db = await readDb(scope);
    const d = checkDetail(db, db.checks.find((c) => c.id === id)!, now);
    expect(d.summary.status).toBe("reconciled");
    expect(d.outcome?.level).toBe("reported");
    expect(d.reconciliation).toMatchObject({ ourError: "-115", quoteError: "300", closer: "ours", closerBy: "185", insideRange: true, againstInvoice: "-1900" });
    expect(d.reconciliation?.sentence).toBe("The supplier reports MXN 253,100: below our typical estimate, inside our range, and below the provider's quote.");
    expect(d.reconciliation?.unknowns).toContain("The cause of the MXN 115 difference is not established.");
  });

  it("a mismatching demo CEP leaves the level unchanged; a matching one gives Verified (demo) only; the account is never stored", async () => {
    const cep = { amount: "253100", date: ymd(now), sendingBank: "Sample bank 1", receivingBank: "Sample bank 2", beneficiaryAccount: "002010077777777771" };
    await mutate(scope, (db) => svc.validateCep(db, id, { demo: "mismatch", ...cep }, ctx));
    expect(svc.currentOutcome(await get(id))?.level).toBe("reported");
    await mutate(scope, (db) => svc.validateCep(db, id, { demo: "match", ...cep }, ctx));
    const c = await get(id);
    expect(svc.currentOutcome(c)?.level).toBe("demo_verified");
    expect(c.evidence.at(-1)).toMatchObject({ mode: "demo", provider: "demo-fixture", result: "verified" });
    expect(JSON.stringify(c)).not.toContain("002010077777777771");
    const db = await readDb(scope);
    expect(checkDetail(db, c, now).reconciliation?.unknowns[0]).toMatch(/Only a DEMO receipt file was checked/);
  });

  it("corrections append; history is never edited", async () => {
    const countBefore = (await get(id)).outcomes.length;
    await mutate(scope, (db) => svc.correctOutcome(db, id, { amount: "253150" }, ctx));
    let c = await get(id);
    expect(c.outcomes.length).toBe(countBefore + 1);
    expect(c.outcomes[0].amount).toBe("253100");
    expect(svc.currentOutcome(c)?.level).toBe("reported"); // verification was for the old amount
    await mutate(scope, (db) => svc.recordPlanChange(db, id, "route", ctx));
    c = await get(id);
    const types = c.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["created", "estimate_computed", "quote_added", "route_selected", "outcome_recorded", "evidence_checked", "outcome_corrected", "plan_change"]));
  });

  it("stale rate needs explicit confirmation before a choice is recorded", async () => {
    await expect(mutate(scope, (db) => svc.recordChoice(db, "CHK-013", { optionId: "fintech_b_mxn", paidOn: ymd(T), confirmStale: false }, { actor: ALEX, nowMs: T }))).rejects.toMatchObject({ code: "STALE_RATE" });
    await mutate(scope, (db) => svc.recordChoice(db, "CHK-013", { optionId: "fintech_b_mxn", paidOn: ymd(T), confirmStale: true }, { actor: ALEX, nowMs: T }));
    expect((await get("CHK-013")).choice?.recordedStale).toBe(true);
  });

  it("retrying a failed calculation keeps inputs and produces an estimate", async () => {
    await mutate(scope, (db) => svc.recalculate(db, "CHK-019", { actor: ALEX, nowMs: T }));
    const c = await get("CHK-019");
    expect(c.calcError).toBeNull();
    expect(c.estimates).toHaveLength(1);
  });
});
