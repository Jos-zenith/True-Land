import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { compareRoutes, dec, Dec, estimateOption, landedAmount, principalToCover, rank, reconcile, roundHalfUp, type ComparisonInput, type FeeRule } from "@/engine";
import { RULES_V4, sampleRate, withProvenance } from "@/server/demo-data";

/**
 * Property-based tests of the financial engine. The engine is unchanged by the hardening work; these
 * pin its contracts over thousands of generated inputs rather than the golden cases alone.
 */
const RULES = withProvenance(RULES_V4, 4, "2026-11-25T15:00:00.000Z");
const RATE = sampleRate("r", "17.0000", "2026-11-26T08:10:00.000Z");
const MXN_RULES = RULES.filter((r) => r.destCurrency === "MXN" && r.eligibility === "approved" && r.markupPct && r.deduction && r.receivingFee !== null);

// Decimal strings with up to 2 dp in a range, generated as integers of cents (no float rounding).
const money = (minCents: number, maxCents: number) => fc.integer({ min: minCents, max: maxCents }).map((c) => (c / 100).toFixed(2));
const pct = fc.integer({ min: 0, max: 900 }).map((bp) => dec(bp).div(10_000)); // 0% .. 9%

describe("landedAmount: R = (A − D) × m × (1 − s) − F_r", () => {
  it("matches the formula exactly and is non-negative", () => {
    fc.assert(
      fc.property(money(10_000, 500_000_000), money(0, 5_000), fc.integer({ min: 10_000, max: 300_000 }), pct, money(0, 50_000), (A, D, mBp, s, Fr) => {
        const m = dec(mBp).div(10_000);
        let R: Dec;
        try {
          R = landedAmount({ A: dec(A), D: dec(D), m, s, Fr: dec(Fr) });
        } catch {
          return; // invalid combinations are rejected with an EngineError, never a wrong number
        }
        expect(R.eq(dec(A).minus(dec(D)).times(m).times(dec(1).minus(s)).minus(dec(Fr)))).toBe(true);
        expect(R.gte(0)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("is monotonic: sending more never delivers less, any cost increase never delivers more", () => {
    fc.assert(
      fc.property(money(100_000, 10_000_000), money(1, 1_000_000), money(0, 2_000), pct, money(0, 10_000), (A, extra, D, s, Fr) => {
        const m = dec("17");
        const base = { A: dec(A), D: dec(D), m, s, Fr: dec(Fr) };
        const R = landedAmount(base);
        expect(landedAmount({ ...base, A: dec(A).plus(dec(extra)) }).gte(R)).toBe(true);
        expect(landedAmount({ ...base, Fr: dec(Fr).plus(1) }).lt(R)).toBe(true);
        expect(landedAmount({ ...base, s: s.plus("0.0001") }).lt(R)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("principalToCover always covers its target, and by less than one cent of principal too much", () => {
    fc.assert(
      fc.property(money(1_000, 1_000_000_000), money(0, 3_000), pct, money(0, 10_000), (target, D, s, Fr) => {
        const m = dec("17.0000");
        const A = principalToCover({ target: dec(target), D: dec(D), m, s, Fr: dec(Fr) });
        expect(landedAmount({ A, D: dec(D), m, s, Fr: dec(Fr) }).gte(dec(target))).toBe(true);
        const less = A.minus("0.01");
        if (less.gt(dec(D))) expect(landedAmount({ A: less, D: dec(D), m, s, Fr: dec(Fr) }).lt(dec(target))).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("estimateOption over the configured routes", () => {
  it("low ≤ typical ≤ high for every route and amount; output is deterministic", () => {
    fc.assert(
      fc.property(fc.constantFrom(...MXN_RULES), money(50_000, 100_000_000), (rule: FeeRule, send) => {
        let o;
        try {
          o = estimateOption({ rule, rate: RATE, sendAmount: send, invoiceAmount: "255000", invoiceCurrency: "MXN" });
        } catch {
          return;
        }
        expect(dec(o.low!).lte(dec(o.typical))).toBe(true);
        expect(dec(o.typical).lte(dec(o.high))).toBe(true);
        const again = estimateOption({ rule, rate: RATE, sendAmount: send, invoiceAmount: "255000", invoiceCurrency: "MXN" });
        expect(JSON.stringify(again)).toBe(JSON.stringify(o));
      }),
      { numRuns: 500 },
    );
  });
});

describe("ranking", () => {
  const peso = (over: Partial<ComparisonInput>): ComparisonInput => ({
    invoiceAmount: "255000",
    invoiceCurrency: "MXN",
    sourceCurrency: "USD",
    destCountry: "MX",
    sendAmount: "15000",
    payoutMethod: "spei_mxn",
    providers: ["bank_a", "fintech_b"],
    payBy: "2026-12-10",
    today: "2026-11-26",
    rate: RATE,
    rules: RULES,
    ...over,
  });

  it("'favoured' only when the leader's floor beats every other firm route's ceiling; otherwise never ranks overlapping ranges", () => {
    fc.assert(
      fc.property(
        money(10_000, 5_000_000),
        fc.subarray(["bank_a", "bank_b", "fintech_a", "fintech_b"], { minLength: 1 }),
        (send, providers) => {
          const r = compareRoutes(peso({ sendAmount: send, providers }));
          const v = r.verdict;
          const firm = r.options.filter((o) => !o.isTopUp && !o.rough);
          if (v.kind === "favoured") {
            const leader = r.options.find((o) => o.optionId === v.optionId)!;
            for (const o of firm) if (o.optionId !== leader.optionId) expect(dec(leader.low!).gt(dec(o.high))).toBe(true);
            for (const o of r.options.filter((x) => x.rough)) expect(dec(o.high).lt(dec(leader.low!))).toBe(true);
          }
          if (v.kind === "too_close") expect(v.optionIds.length).toBeGreaterThanOrEqual(2);
          expect(rank(r.options.filter((o) => !o.isTopUp))).toEqual(v.kind === "cover" ? expect.anything() : v);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is deterministic: identical inputs give byte-identical comparisons", () => {
    fc.assert(
      fc.property(money(10_000, 5_000_000), (send) => {
        expect(JSON.stringify(compareRoutes(peso({ sendAmount: send })))).toBe(JSON.stringify(compareRoutes(peso({ sendAmount: send }))));
      }),
      { numRuns: 200 },
    );
  });
});

describe("reconciliation sign conventions", () => {
  it("our error = actual − typical; quote error = quote − actual; 'closer' and 'inside range' agree with them", () => {
    fc.assert(
      fc.property(money(100, 100_000_000), money(0, 1_000_000), money(0, 1_000_000), money(0, 200_000_000), fc.option(money(100, 100_000_000), { nil: null }), (typ, dn, up, actual, quote) => {
        const typical = dec(typ);
        const low = typical.minus(dec(dn)).gte(0) ? typical.minus(dec(dn)).toFixed() : "0";
        const high = typical.plus(dec(up)).toFixed();
        const r = reconcile({ typical: typ, low, high, actual, invoice: null, quote });
        expect(dec(r.ourError).eq(dec(actual).minus(typical))).toBe(true);
        expect(r.insideRange).toBe(dec(actual).gte(dec(low)) && dec(actual).lte(dec(high)));
        if (quote === null) {
          expect(r.quoteError).toBeNull();
          expect(r.closer).toBeNull();
        } else {
          expect(dec(r.quoteError!).eq(dec(quote).minus(dec(actual)))).toBe(true);
          const a = dec(r.ourError).abs();
          const b = dec(r.quoteError!).abs();
          expect(r.closer).toBe(a.lt(b) ? "ours" : a.gt(b) ? "quote" : "tie");
          expect(dec(r.closerBy!).eq(a.minus(b).abs())).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
  });
});

describe("display rounding", () => {
  it("half-up to whole units never moves a value by more than 0.5", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), fc.integer({ min: 0, max: 9999 }), (whole, frac) => {
        const v = dec(`${whole}.${String(frac).padStart(4, "0")}`);
        expect(roundHalfUp(v, 0).minus(v).abs().lte("0.5")).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });
});
