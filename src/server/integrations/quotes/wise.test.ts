import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { fakeFetch, fixture, noSleep } from "@/test/fakes";
import { analyseProviderQuote, dec } from "@/engine";
import { IntegrationError, parseJsonExact, resetCircuitBreakers } from "../http";
import { amountProblem } from "../currency";
import { WiseAdapter } from "./wise";
import { effectiveQuoteStatus, type QuoteRequest } from "./types";

const NOW = Date.parse("2026-11-27T06:40:00Z");
const now = () => NOW;
const REQ = (amount: string): QuoteRequest => ({ sourceCurrency: "USD", targetCurrency: "MXN", sourceAmount: amount });
const AMOUNTS = ["5000", "15000", "50000"] as const;

beforeEach(() => resetCircuitBreakers());

const wise = (reply: Parameters<typeof fakeFetch>[0], o: { token?: string; profileId?: string } = {}) => {
  const f = fakeFetch(reply);
  return { a: new WiseAdapter({ baseUrl: "https://api.wise.com", version: "2026Q4", fetch: f.fetch, sleep: noSleep, now, token: o.token ?? "", profileId: o.profileId ?? "" }), calls: f.calls };
};
const kindOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof IntegrationError ? e.kind : `other:${(e as Error).message}`;
  }
};

describe("Wise quotes: real unauthenticated responses for $5k / $15k / $50k", () => {
  it.each(AMOUNTS)("$%s: normalises rate, fee, delivery, expiry and classification", async (amount) => {
    const text = fixture(`wise-unauthenticated-usd-mxn-${amount}.json`);
    const raw = parseJsonExact(text) as { rate: string; expirationTime: string; paymentOptions: { payIn: string; payOut: string; disabled: boolean; targetAmount: string; price: { total: { value: { amount: string } } } }[] };
    const bank = raw.paymentOptions.find((p) => p.payIn === "BANK_TRANSFER" && p.payOut === "BANK_TRANSFER" && !p.disabled)!;
    const { a, calls } = wise(() => ({ body: text }));
    const q = await a.getQuote(REQ(amount));
    expect(calls[0].url).toBe("https://api.wise.com/2026Q4/quotes");
    expect(calls[0].headers.get("authorization")).toBeNull();
    expect(JSON.parse(calls[0].body!)).toEqual({ sourceCurrency: "USD", targetCurrency: "MXN", sourceAmount: Number(amount) });
    expect(q).toMatchObject({
      provider: "wise",
      quoteStatus: "available",
      evidenceClassification: "unauthenticated_quote",
      exchangeRate: raw.rate,
      targetAmount: bank.targetAmount,
      totalFee: bank.price.total.value.amount,
      feeCurrency: "USD",
      payInMethod: "BANK_TRANSFER",
      payOutMethod: "BANK_TRANSFER",
      quoteExpiresAt: raw.expirationTime,
    });
    expect(q.quoteId).toBeUndefined(); // unauthenticated quotes have no usable id
    // Fee breakdown items add up to the total, exactly.
    const sum = q.feeBreakdown.reduce((s, i) => s.plus(i.amount), dec(0));
    expect(sum.eq(q.totalFee!)).toBe(true);
    // Disabled options (e.g. card pay-in over the limit) are recorded, never offered.
    expect(q.disabledOptions.length).toBeGreaterThan(0);
    expect(q.disabledOptions.every((d) => d.reason.length > 0)).toBe(true);
    // The provider's own arithmetic: (source − fee) × rate ≈ target (to within rounding).
    const an = analyseProviderQuote({ sourceAmount: q.sourceAmount!, targetAmount: q.targetAmount!, providerRate: q.exchangeRate!, fee: q.totalFee!, feeCurrency: q.feeCurrency!, sourceCurrency: "USD", benchmarkRate: q.exchangeRate! });
    expect(dec(an.arithmeticCheck!).abs().lte("0.05")).toBe(true);
  });

  it("a quote past its expiry is reported as expired at read time, never reused", async () => {
    const { a } = wise(() => ({ body: fixture("wise-unauthenticated-usd-mxn-15000.json") }));
    const q = await a.getQuote(REQ("15000"));
    expect(effectiveQuoteStatus(q, Date.parse(q.quoteExpiresAt!) - 1)).toBe("available");
    expect(effectiveQuoteStatus(q, Date.parse(q.quoteExpiresAt!))).toBe("expired");
  });
});

describe("Wise quotes: authenticated mode and failure states", () => {
  it("uses the profile endpoint with a bearer token and requests bank-transfer pay-in and payout", async () => {
    const body = fixture("wise-unauthenticated-usd-mxn-15000.json").replace('{"sourceAmount"', '{"id":"11144c35-9fe8-4c32-b7fd-d05c2a7734bf","sourceAmount"');
    const { a, calls } = wise(() => ({ body }), { token: "wise-test-token", profileId: "12345" });
    expect(a.mode()).toBe("authenticated");
    const q = await a.getQuote(REQ("15000"));
    expect(calls[0].url).toBe("https://api.wise.com/2026Q4/profiles/12345/quotes");
    expect(calls[0].headers.get("authorization")).toBe("Bearer wise-test-token");
    expect(JSON.parse(calls[0].body!)).toMatchObject({ payOut: "BANK_TRANSFER", preferredPayIn: "BANK_TRANSFER" });
    expect(q.evidenceClassification).toBe("authenticated_quote");
    expect(q.quoteId).toBe("11144c35-9fe8-4c32-b7fd-d05c2a7734bf");
  });

  it("a token without a profile is a configuration error, not a silent downgrade", async () => {
    const { a, calls } = wise(() => ({ body: "{}" }), { token: "wise-test-token" });
    expect(await kindOf(a.getQuote(REQ("15000")))).toBe("not_configured");
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "{}", "authentication"],
    [403, "{}", "permission"],
    [404, "{}", "missing_data"],
    [422, '{"errors":[{"message":"Currency route not supported"}]}', "unsupported_currency"],
    [500, "{}", "outage"],
  ] as const)("HTTP %s is classified as %s", async (status, body, kind) => {
    const { a } = wise(() => ({ status, body }), { token: "t", profileId: "1" });
    expect(await kindOf(a.getQuote(REQ("15000")))).toBe(kind);
  });

  it.each([
    [{ sourceCurrency: "USD", targetCurrency: "MXN" }, /either/],
    [{ sourceCurrency: "USD", targetCurrency: "MXN", sourceAmount: "1", targetAmount: "1" }, /either/],
    [{ sourceCurrency: "USD", targetCurrency: "MXN", sourceAmount: "15000.001" }, /at most 2 decimal/],
    [{ sourceCurrency: "USD", targetCurrency: "MXN", sourceAmount: "0" }, /greater than zero/],
    [{ sourceCurrency: "USD", targetCurrency: "XXX", sourceAmount: "100" }, /not a supported currency/],
    [{ sourceCurrency: "USD", targetCurrency: "MXN", sourceAmount: "20000000" }, /limit/],
  ])("rejects an invalid request before calling Wise: %j", async (req, msg) => {
    const { a, calls } = wise(() => ({ body: "{}" }));
    await expect(a.getQuote(req as QuoteRequest)).rejects.toThrow(msg);
    expect(calls).toHaveLength(0);
  });

  it("when every relevant payment option is disabled, the quote is not available and has no amount", async () => {
    const all = (parseJsonExact(fixture("wise-unauthenticated-usd-mxn-15000.json")) as Record<string, unknown>) as { paymentOptions: { disabled: boolean }[] };
    for (const p of all.paymentOptions) p.disabled = true;
    const { a } = wise(() => ({ body: JSON.stringify(all) }));
    const q = await a.getQuote(REQ("15000"));
    expect(q.quoteStatus).toBe("no_enabled_option");
    expect(q.targetAmount).toBeUndefined();
    expect(q.totalFee).toBeUndefined();
  });

  it("a BLOCKED notice makes the quote unusable", async () => {
    const body = fixture("wise-unauthenticated-usd-mxn-15000.json").replace('"notices":[]', '"notices":[{"text":"Blocked for this route","link":null,"type":"BLOCKED"}]');
    const { a } = wise(() => ({ body }));
    expect((await a.getQuote(REQ("15000"))).quoteStatus).toBe("blocked");
  });

  it("missing recipient requirements give a labelled incomplete quote, not an error, and no banking data is sent", async () => {
    const { a, calls } = wise(() => ({ status: 422, body: '{"errors":[{"code":"error.targetAccount.required","message":"targetAccount is required"}]}' }), { token: "t", profileId: "1" });
    const q = await a.getQuote(REQ("15000"));
    expect(q.quoteStatus).toBe("requires_recipient");
    expect(calls[0].body).not.toMatch(/account|clabe|recipient/i);
  });

  it("refuses a quote for a different corridor than requested", async () => {
    const { a } = wise(() => ({ body: fixture("wise-unauthenticated-usd-mxn-15000.json").replace(/"targetCurrency":"MXN"/g, '"targetCurrency":"INR"') }));
    expect(await kindOf(a.getQuote(REQ("15000")))).toBe("invalid_response");
  });
});

describe("provider quote vs benchmark (engine)", () => {
  it("measures cost against the benchmark without applying any second markup", () => {
    const an = analyseProviderQuote({ sourceAmount: "15000", targetAmount: "292405.75", providerRate: "19.6005", fee: "81.72", feeCurrency: "USD", sourceCurrency: "USD", benchmarkRate: "19.6691" });
    expect(an.benchmarkReceipt).toBe("295036.5");
    expect(an.costVsBenchmark).toBe("2630.75");
    expect(dec(an.allInCostPct).toDecimalPlaces(4).toFixed()).toBe("0.8917");
    expect(dec(an.rateVsBenchmarkPct!).toDecimalPlaces(4).toFixed()).toBe("-0.3488");
    expect(an.feePct).toBe("0.5448");
    expect(an.effectiveRate).toBe(dec("292405.75").div("15000").toFixed());
  });

  it("property: cost is exactly benchmark receipt minus the provider's target, for any inputs", () => {
    const amt = fc.integer({ min: 100, max: 1e9 }).map((c) => (c / 100).toFixed(2));
    const rate = fc.integer({ min: 1, max: 1e7 }).map((n) => (n / 1e4).toFixed(4));
    fc.assert(
      fc.property(amt, amt, rate, (A, T, m) => {
        const an = analyseProviderQuote({ sourceAmount: A, targetAmount: T, providerRate: null, fee: null, feeCurrency: null, sourceCurrency: "USD", benchmarkRate: m });
        expect(dec(an.costVsBenchmark).eq(dec(A).times(m).minus(T))).toBe(true);
        expect(an.feePct).toBeNull();
        expect(an.arithmeticCheck).toBeNull();
      }),
      { numRuns: 500 },
    );
  });

  it("a fee in another currency is never mixed into a source-currency percentage", () => {
    const an = analyseProviderQuote({ sourceAmount: "100", targetAmount: "1900", providerRate: "19.5", fee: "50", feeCurrency: "MXN", sourceCurrency: "USD", benchmarkRate: "19.6" });
    expect(an.feePct).toBeNull();
    expect(an.arithmeticCheck).toBeNull();
  });
});

describe("currency precision", () => {
  it("uses ISO minor units per currency, never a blanket two decimals", () => {
    expect(amountProblem("100.5", "JPY")).toMatch(/at most 0 decimal places/);
    expect(amountProblem("100", "JPY")).toBeNull();
    expect(amountProblem("1.234", "BHD")).toBeNull();
    expect(amountProblem("1.2345", "BHD")).toMatch(/at most 3/);
    expect(amountProblem("10.12", "MXN")).toBeNull();
  });
});
