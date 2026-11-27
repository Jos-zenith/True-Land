import { describe, it, expect } from "vitest";
import {
  analyseQuote,
  businessDaysBetween,
  compareRoutes,
  dec,
  estimateOption,
  isValidClabe,
  landedAmount,
  principalToCover,
  rank,
  rateFreshness,
  reconcile,
  roundHalfUp,
  EngineError,
  type ComparisonInput,
  type FeeRule,
} from "@/engine";
import { RULES_V4, INDIA_FIXTURE_RULE, sampleRate, withProvenance } from "@/server/demo-data";

const RULES = withProvenance(RULES_V4, 4, "2026-11-25T15:00:00.000Z");
const RATE = sampleRate("r", "17.0000", "2026-11-26T08:10:00.000Z");
const rule = (id: string): FeeRule => RULES.find((r) => r.id === id)!;
const whole = (s: string | null) => (s === null ? null : roundHalfUp(dec(s), 0).toFixed());

const peso = (over: Partial<ComparisonInput> = {}): ComparisonInput => ({
  invoiceAmount: "255000",
  invoiceCurrency: "MXN",
  sourceCurrency: "USD",
  destCountry: "MX",
  sendAmount: "15000",
  payoutMethod: "spei_mxn",
  providers: ["bank_a", "fintech_b"],
  payBy: "2026-11-30",
  today: "2026-11-26",
  rate: RATE,
  rules: RULES,
  ...over,
});

describe("landed amount formula R = (A − D) × m × (1 − s) − F_r", () => {
  it("PRD golden case: $10,000, 3% markup, $25 deduction ≈ $9,676 equivalent", () => {
    const R = landedAmount({ A: dec(10000), D: dec(25), m: dec(1), s: dec("0.03"), Fr: dec(0) });
    expect(R.toFixed()).toBe("9675.75");
    expect(roundHalfUp(R, 0).toFixed()).toBe("9676");
    // Same case through a real conversion: equivalent value is identical at mid-market.
    const mxn = landedAmount({ A: dec(10000), D: dec(25), m: dec(17), s: dec("0.03"), Fr: dec(0) });
    expect(mxn.toFixed()).toBe("164487.75");
    expect(mxn.div(17).toFixed()).toBe("9675.75");
  });

  it("zero fees: receipt is exactly A × m", () => {
    expect(landedAmount({ A: dec(15000), D: dec(0), m: dec(17), s: dec(0), Fr: dec(0) }).toFixed()).toBe("255000");
  });

  it("receiving fee is subtracted in destination currency after conversion", () => {
    const R = landedAmount({ A: dec(1000), D: dec(0), m: dec(17), s: dec(0), Fr: dec(50) });
    expect(R.toFixed()).toBe("16950");
  });

  it("deduction is taken before conversion, and only once", () => {
    const R = landedAmount({ A: dec(1000), D: dec(10), m: dec(17), s: dec(0), Fr: dec(0) });
    expect(R.toFixed()).toBe("16830"); // (1000-10)*17, not 1000*17 - 10*17*2
  });

  it("rejects negative and impossible inputs", () => {
    expect(() => landedAmount({ A: dec(-1), D: dec(0), m: dec(17), s: dec(0), Fr: dec(0) })).toThrow(EngineError);
    expect(() => landedAmount({ A: dec(100), D: dec(-5), m: dec(17), s: dec(0), Fr: dec(0) })).toThrow(EngineError);
    expect(() => landedAmount({ A: dec(100), D: dec(100), m: dec(17), s: dec(0), Fr: dec(0) })).toThrow(/consume/);
    expect(() => landedAmount({ A: dec(100), D: dec(0), m: dec(17), s: dec(1), Fr: dec(0) })).toThrow(EngineError);
    expect(() => dec("12abc")).toThrow(EngineError);
    expect(() => dec(Number.NaN)).toThrow(EngineError);
  });

  it("very large amounts keep full precision", () => {
    const R = landedAmount({ A: dec("987654321.12"), D: dec(25), m: dec("17.1234"), s: dec("0.007"), Fr: dec(0) });
    expect(R.toFixed()).toBe(dec("987654296.12").times("17.1234").times("0.993").toFixed());
    expect(R.toFixed()).toBe("16793615577.161939544"); // cross-checked with Python decimal
  });

  it("display rounding is half-up, and only at the boundary", () => {
    expect(roundHalfUp(dec("246937.75"), 0).toFixed()).toBe("246938");
    expect(roundHalfUp(dec("0.5"), 0).toFixed()).toBe("1");
    expect(roundHalfUp(dec("-0.5"), 0).toFixed()).toBe("-1");
    expect(roundHalfUp(dec("15105.745"), 2).toFixed()).toBe("15105.75");
  });
});

describe("peso invoice, wireframe CHK-014", () => {
  it("Fintech B: MXN 253,215 typical, 252,960 low, 253,470 high; you pay USD 15,012", () => {
    const o = estimateOption({ rule: rule("fintech_b_mxn"), rate: RATE, sendAmount: "15000", invoiceAmount: "255000", invoiceCurrency: "MXN" });
    expect(o.typical).toBe("253215");
    expect(o.low).toBe("252960");
    expect(o.high).toBe("253470");
    expect(o.youPay).toBe("15012");
    expect(o.shortfallTypical).toBe("1785");
    // Even the high case (253,470) is below the 255,000 invoice: short in every case.
    expect(o.covers).toBe("short_all");
  });

  it("cover amounts are rounded UP so the invoice is always met", () => {
    const o = estimateOption({ rule: rule("fintech_b_mxn"), rate: RATE, sendAmount: "15000", invoiceAmount: "255000", invoiceCurrency: "MXN" });
    // 255000 / (17 × 0.993) = 15105.7402… → 15105.75 (the wireframe shows 15,105.74, which would arrive MXN 0.01 short)
    expect(o.coverSend.typical).toBe("15105.75");
    expect(o.coverSend.low).toBe("15120.97");
    const check = landedAmount({ A: dec(o.coverSend.typical!), D: dec(0), m: dec(17), s: dec("0.007"), Fr: dec(0) });
    expect(check.gte(255000)).toBe(true);
  });

  it("Bank A wire: MXN 246,938 typical, 245,419 low, 248,459 high; you pay USD 15,030", () => {
    const o = estimateOption({ rule: rule("bank_a_mxn"), rate: RATE, sendAmount: "15000", invoiceAmount: "255000", invoiceCurrency: "MXN" });
    expect(whole(o.typical)).toBe("246938");
    expect(whole(o.low)).toBe("245419");
    expect(whole(o.high)).toBe("248459");
    expect(o.youPay).toBe("15030");
  });

  it("sender fee is paid on top and never reduces the receipt", () => {
    const base = rule("fintech_b_mxn");
    const a = estimateOption({ rule: base, rate: RATE, sendAmount: "15000", invoiceAmount: "255000", invoiceCurrency: "MXN" });
    const b = estimateOption({ rule: { ...base, senderFee: "500" }, rate: RATE, sendAmount: "15000", invoiceAmount: "255000", invoiceCurrency: "MXN" });
    expect(b.typical).toBe(a.typical);
    expect(b.youPay).toBe("15500");
  });

  it("breakdown lines reconcile to the result (no double counting)", () => {
    const o = estimateOption({ rule: rule("bank_a_mxn"), rate: RATE, sendAmount: "15000", invoiceAmount: "255000", invoiceCurrency: "MXN" });
    for (const c of ["low", "typical", "high"] as const) {
      const lines = o.cases[c].lines;
      const conv = dec(lines.find((l) => l.key === "conversion")!.amount);
      const markup = dec(lines.find((l) => l.key === "markup")!.amount);
      const fee = dec(lines.find((l) => l.key === "receiving_fee")!.amount);
      expect(conv.plus(markup).plus(fee).toFixed()).toBe(o.cases[c].receipt);
      const principal = dec(lines.find((l) => l.key === "principal")!.amount);
      const ded = dec(lines.find((l) => l.key === "deduction")!.amount);
      expect(principal.plus(ded).times(17).toFixed()).toBe(conv.toFixed());
    }
  });

  it("comparison: Fintech B is favoured, Bank A USD wire excluded because the invoice is in pesos", () => {
    const r = compareRoutes(peso());
    expect(r.mode).toBe("compare");
    expect(r.verdict.kind).toBe("favoured");
    if (r.verdict.kind === "favoured") expect(r.verdict.optionId).toBe("fintech_b_mxn");
    expect(r.excluded.map((e) => e.ruleId).sort()).toEqual(["bank_a_usd_ben", "bank_a_usd_our", "bank_a_usd_sha"]);
    expect(r.excluded[0].reason).toBe("this invoice is in pesos");
    expect(r.grossAtMid).toBe("255000");
  });

  it("provider quote MXN 253,400 is 185 above typical, inside range, implies ≈0.63% markup", () => {
    const o = estimateOption({ rule: rule("fintech_b_mxn"), rate: RATE, sendAmount: "15000", invoiceAmount: "255000", invoiceCurrency: "MXN" });
    const q = analyseQuote({ rule: rule("fintech_b_mxn"), rate: RATE, sendAmount: "15000", quote: { kind: "amount", amount: "253400" }, typical: o.typical, low: o.low, high: o.high });
    expect(q.diffFromTypical).toBe("185");
    expect(q.insideRange).toBe(true);
    expect(roundHalfUp(dec(q.impliedMarkupPct!), 2).toFixed()).toBe("0.63");
  });

  it("quoted RATE is applied directly, without a second markup", () => {
    const q = analyseQuote({ rule: rule("fintech_b_mxn"), rate: RATE, sendAmount: "15000", quote: { kind: "rate", rate: "16.9" }, typical: "253215", low: "252960", high: "253470" });
    expect(q.quotedReceipt).toBe("253500"); // 15000 × 16.9, no extra 0.7%
  });
});

describe("dollar wire, wireframe CHK-015", () => {
  const usd = (over: Partial<ComparisonInput> = {}) =>
    compareRoutes(peso({ invoiceAmount: "15000", invoiceCurrency: "USD", payoutMethod: "usd_account", providers: ["bank_a"], ...over }));

  it("SHA / OUR / BEN figures and the top-up that covers even the low case", () => {
    const r = usd();
    expect(r.mode).toBe("cover");
    const by = (id: string) => r.options.find((o) => o.optionId === id)!;
    expect([by("bank_a_usd_sha").low, by("bank_a_usd_sha").typical, by("bank_a_usd_sha").high, by("bank_a_usd_sha").youPay]).toEqual(["14960", "14975", "14990", "15030"]);
    expect([by("bank_a_usd_our").low, by("bank_a_usd_our").typical, by("bank_a_usd_our").high, by("bank_a_usd_our").youPay]).toEqual(["14985", "15000", "15000", "15055"]);
    expect([by("bank_a_usd_ben").low, by("bank_a_usd_ben").typical, by("bank_a_usd_ben").high, by("bank_a_usd_ben").youPay]).toEqual(["14930", "14945", "14960", "15000"]);
    expect(by("bank_a_usd_ben").covers).toBe("short_all");
    expect(by("bank_a_usd_our").covers).toBe("typical");
    expect(r.verdict.kind).toBe("cover");
    if (r.verdict.kind !== "cover") return;
    expect(r.verdict.plannedOptionId).toBe("bank_a_usd_sha");
    expect(r.verdict.covers).toBe("short_all"); // SHA high 14,990 < 15,000
    const top = by(r.verdict.topUpOptionId!);
    expect(top.sendAmount).toBe("15040");
    expect([top.low, top.typical, top.high, top.youPay]).toEqual(["15000", "15015", "15030", "15070"]);
    expect(top.covers).toBe("even_low");
  });

  it("no markup is applied when no conversion happens", () => {
    const r = usd();
    const sha = r.options.find((o) => o.optionId === "bank_a_usd_sha")!;
    expect(sha.cases.typical.lines.some((l) => l.key === "markup")).toBe(false);
  });
});

describe("ranking rules", () => {
  it("overlapping ranges are too close to call, and no rank is given", () => {
    const r = compareRoutes(peso({ providers: ["fintech_a", "fintech_b"], sendAmount: "5000", invoiceAmount: "85000" }));
    expect(r.verdict.kind).toBe("too_close");
  });

  it("an unverified route is excluded with its reason and never ranked", () => {
    const r = compareRoutes(peso({ providers: ["fintech_b", "fintech_x"] }));
    expect(r.options.map((o) => o.optionId)).toEqual(["fintech_b_mxn"]);
    expect(r.excluded.find((e) => e.ruleId === "fintech_x_mxn")?.code).toBe("eligibility_unverified");
    expect(r.verdict.kind).toBe("single");
  });

  it("a missing fee makes the estimate rough: no low, not used to rank when it could compete", () => {
    const r = compareRoutes(peso({ providers: ["bank_b", "fintech_b"] }));
    const b = r.options.find((o) => o.ruleId === "bank_b_mxn")!;
    expect(b.rough).toBe(true);
    expect(b.low).toBeNull();
    expect(b.missing).toEqual(["receiving fee"]);
    expect(b.coverSend.typical).toBeNull();
    expect(r.verdict.kind).toBe("unrankable");
  });

  it("a rough route whose upper figure is below the leader's floor cannot change the result", () => {
    const cheapB = { ...rule("bank_b_mxn"), markupPct: { low: "3.5", typical: "3", high: "2.5" } };
    const r = compareRoutes(peso({ providers: ["bank_b", "fintech_b"], rules: RULES.map((x) => (x.id === "bank_b_mxn" ? cheapB : x)) }));
    expect(r.verdict.kind).toBe("favoured");
  });

  it("disabled and late routes are unavailable with a reason", () => {
    const disabled = RULES.map((x) => (x.id === "fintech_b_mxn" ? { ...x, eligibility: "disabled" as const } : x));
    const r = compareRoutes(peso({ rules: disabled, payBy: "2026-11-27" }));
    expect(r.excluded.find((e) => e.ruleId === "fintech_b_mxn")?.code).toBe("disabled");
    expect(r.excluded.find((e) => e.ruleId === "bank_a_mxn")?.code).toBe("arrives_late");
    expect(r.verdict.kind).toBe("none_eligible");
    if (r.verdict.kind === "none_eligible") expect(r.verdict.reason).toBe("Nothing arrives by the pay-by date.");
  });

  it("rank() with no options or one option never invents a winner", () => {
    expect(rank([]).kind).toBe("none_eligible");
  });
});

describe("validation of corridors and currencies", () => {
  it("rejects invalid currency combinations", () => {
    expect(() => compareRoutes(peso({ invoiceCurrency: "INR" }))).toThrow(/not supported/);
    expect(() => compareRoutes(peso({ sourceCurrency: "MXN" }))).toThrow(/USD/);
    expect(() =>
      estimateOption({ rule: rule("fintech_b_mxn"), rate: { ...RATE, quote: "INR" }, sendAmount: "100", invoiceAmount: "1", invoiceCurrency: "MXN" }),
    ).toThrow(/cannot price/);
    expect(() =>
      estimateOption({ rule: rule("fintech_b_mxn"), rate: null, sendAmount: "100", invoiceAmount: "1", invoiceCurrency: "MXN" }),
    ).toThrow(/No exchange rate/);
  });

  it("rejects zero and negative amounts", () => {
    expect(() => compareRoutes(peso({ sendAmount: "0" }))).toThrow(EngineError);
    expect(() => compareRoutes(peso({ invoiceAmount: "-5" }))).toThrow(EngineError);
  });

  it("control corridor (US → India) is computed by the same engine (test fixture only)", () => {
    const o = estimateOption({
      rule: INDIA_FIXTURE_RULE,
      rate: { ...RATE, quote: "INR", rate: "83.2000" },
      sendAmount: "5000",
      invoiceAmount: "416000",
      invoiceCurrency: "INR",
    });
    expect(o.typical).toBe("412672"); // 5000 × 83.2 × 0.992
  });
});

describe("determinism, staleness, reconciliation", () => {
  it("same inputs give identical output", () => {
    expect(JSON.stringify(compareRoutes(peso()))).toBe(JSON.stringify(compareRoutes(peso())));
  });

  it("rate is stale at 24 hours and warns from 20", () => {
    const now = new Date("2026-11-27T15:10:00.000Z").getTime();
    expect(rateFreshness("2026-11-26T08:10:00.000Z", now)).toMatchObject({ stale: true, hours: 31 });
    expect(rateFreshness("2026-11-26T18:10:00.000Z", now)).toMatchObject({ stale: false, warn: true });
  });

  it("wireframe reconciliation: actual 253,100 vs typical 253,215 and quote 253,400", () => {
    const r = reconcile({ typical: "253215", low: "252960", high: "253470", actual: "253100", invoice: "255000", quote: "253400" });
    expect(r.ourError).toBe("-115");
    expect(r.quoteError).toBe("300");
    expect(r.closer).toBe("ours");
    expect(r.closerBy).toBe("185");
    expect(r.insideRange).toBe(true);
    expect(r.againstInvoice).toBe("-1900");
    expect(r.actualVsTypical).toBe("below");
    expect(r.actualVsQuote).toBe("below");
  });

  it("outside range is detected; no quote means no quote error", () => {
    const r = reconcile({ typical: "84405", low: "84235", high: "84575", actual: "83900", invoice: "85000", quote: null });
    expect(r.ourError).toBe("-505");
    expect(r.insideRange).toBe(false);
    expect(r.quoteError).toBeNull();
    expect(r.closer).toBeNull();
  });

  it("business days skip weekends", () => {
    expect(businessDaysBetween("2026-11-26", "2026-11-30")).toBe(2); // Fri, Mon
    expect(businessDaysBetween("2026-11-26", "2026-11-26")).toBe(0);
    expect(businessDaysBetween("2026-11-26", "2026-11-20")).toBe(-1);
  });

  it("principalToCover inverts the formula", () => {
    const A = principalToCover({ target: dec(15000), D: dec(40), m: dec(1), s: dec(0), Fr: dec(0) });
    expect(A.toFixed()).toBe("15040");
  });

  it("CLABE check digit", () => {
    expect(isValidClabe("002010077777777771")).toBe(true);
    expect(isValidClabe("002010077777777772")).toBe(false);
    expect(isValidClabe("12345")).toBe(false);
  });
});
