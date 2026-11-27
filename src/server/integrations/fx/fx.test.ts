import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { fakeFetch, fixture, noSleep, timeoutError } from "@/test/fakes";
import { IntegrationError, parseJsonExact, requestJson, resetCircuitBreakers, safeReference } from "../http";
import { FrankfurterAdapter } from "./frankfurter";
import { CurrencyApiAdapter } from "./currencyapi";
import { POLICY_V1, selectBenchmark } from "./benchmark";
import { observationFreshness } from "./freshness";
import type { FxObservation, FxResult } from "./types";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const RULES = { freshHours: 48, staleHours: 96 };
const now = () => NOW;
const errors = JSON.parse(fixture("currencyapi-doc-errors.json")) as Record<string, unknown>;

beforeEach(() => resetCircuitBreakers());

const frank = (reply: Parameters<typeof fakeFetch>[0], o: { institution?: string } = {}) => {
  const f = fakeFetch(reply);
  return { a: new FrankfurterAdapter({ fetch: f.fetch, sleep: noSleep, now, ...o }), calls: f.calls };
};
const capi = (reply: Parameters<typeof fakeFetch>[0], key: string | undefined = "test-currencyapi-key-123") => {
  const f = fakeFetch(reply);
  return { a: new CurrencyApiAdapter({ apiKey: key, fetch: f.fetch, sleep: noSleep, now }), calls: f.calls };
};
const kindOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof IntegrationError ? e.kind : `other:${(e as Error).message}`;
  }
};

describe("Frankfurter adapter (real captured responses)", () => {
  it("latest USD/MXN: exact decimal rate, observation date, contributors, no credentials", async () => {
    const { a, calls } = frank(() => ({ body: fixture("frankfurter-latest-usd-mxn.json") }));
    const o = await a.getLatestRate("USD", "MXN");
    const raw = JSON.parse(fixture("frankfurter-latest-usd-mxn.json"))[0];
    expect(o.rate).toBe(String(raw.rate)); // exact text from the response, never re-formatted floats
    expect(o.observedDate).toBe(raw.date);
    expect(o.observedAt).toBe(`${raw.date}T00:00:00.000Z`);
    expect(o.retrievedAt).toBe(new Date(NOW).toISOString());
    expect(o.dataset).toBe("blend");
    expect(o.attribution.label).toMatch(/not an official fixing/);
    expect(o.attribution.contributors?.some((c) => c.key === "ECB")).toBe(true);
    expect(o.rawResponseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0].url).toBe("https://api.frankfurter.dev/v2/rates?base=USD&quotes=MXN&expand=providers");
  });

  it("historical USD/MXN for a date", async () => {
    const { a, calls } = frank(() => ({ body: fixture("frankfurter-historical-usd-mxn-2026-11-20.json") }));
    const o = await a.getHistoricalRate("USD", "MXN", "2026-11-20");
    expect(o.observedDate).toBe("2026-11-20");
    expect(calls[0].url).toContain("date=2026-11-20");
  });

  it("a single institution can be requested and is attributed to it", async () => {
    const { a, calls } = frank(() => ({ body: '[{"date":"2026-11-26","base":"USD","quote":"MXN","rate":19.6713}]' }), { institution: "ecb" });
    const o = await a.getLatestRate("USD", "MXN");
    expect(calls[0].url).toContain("providers=ecb");
    expect(o.dataset).toBe("ECB");
    expect(o.attribution.label).toBe("Frankfurter, ECB reference rate");
  });

  it("invalid currency is classified as unsupported", async () => {
    const { a } = frank(() => ({ status: 422, body: fixture("frankfurter-invalid-currency.json") }));
    expect(await kindOf(a.getLatestRate("USD", "XXX"))).toBe("unsupported_currency");
  });

  it("an empty response is missing data, not a zero rate", async () => {
    const { a } = frank(() => ({ body: "[]" }));
    expect(await kindOf(a.getLatestRate("USD", "MXN"))).toBe("missing_data");
  });

  it("an unexpected schema is rejected", async () => {
    const { a } = frank(() => ({ body: '{"rates":{"MXN":19.6}}' }));
    expect(await kindOf(a.getLatestRate("USD", "MXN"))).toBe("invalid_response");
    const { a: b } = frank(() => ({ body: '[{"date":"2026-11-27","base":"USD","quote":"MXN","rate":"abc"}]' }));
    expect(await kindOf(b.getLatestRate("USD", "MXN"))).toBe("invalid_response");
  });

  it("a timeout is retried, then reported as a timeout", async () => {
    const { a, calls } = frank(() => timeoutError());
    expect(await kindOf(a.getLatestRate("USD", "MXN"))).toBe("timeout");
    expect(calls).toHaveLength(3); // 1 + 2 retries
  });

  it("supported currencies exclude crypto", async () => {
    const { a } = frank(() => ({ body: fixture("frankfurter-currencies.json") }));
    const list = await a.getSupportedCurrencies();
    expect(list.some((c) => c.code === "MXN")).toBe(true);
    expect(list.some((c) => c.code === "ADA")).toBe(false);
  });
});

describe("CurrencyAPI adapter (documented shapes; no live key available)", () => {
  it("latest USD/MXN uses the observation time from meta.last_updated_at and sends the key in a header only", async () => {
    const { a, calls } = capi(() => ({ body: fixture("currencyapi-doc-latest-usd-mxn.json") }));
    const o = await a.getLatestRate("USD", "MXN");
    expect(o.rate).toBe("19.6512");
    expect(o.observedAt).toBe("2026-11-26T23:59:59.000Z");
    expect(calls[0].headers.get("apikey")).toBe("test-currencyapi-key-123");
    expect(calls[0].url).not.toContain("test-currencyapi-key-123");
    expect(o.sourceReference).not.toContain("test-currencyapi-key-123");
  });

  it("historical rate requests the date", async () => {
    const { a, calls } = capi(() => ({ body: '{"meta":{"last_updated_at":"2026-11-20T23:59:59Z","date":"2026-11-20"},"data":{"MXN":{"code":"MXN","value":19.02}}}' }));
    const o = await a.getHistoricalRate("USD", "MXN", "2026-11-20");
    expect(calls[0].url).toContain("/historical?date=2026-11-20");
    expect(o.observedDate).toBe("2026-11-20");
  });

  it.each([
    ["401", "authentication"],
    ["403", "permission"],
    ["422", "unsupported_currency"],
    ["429", "rate_limit"],
  ])("HTTP %s is classified as %s", async (status, kind) => {
    const { a } = capi(() => ({ status: Number(status), body: JSON.stringify(errors[status]) }));
    expect(await kindOf(a.getLatestRate("USD", "MXN"))).toBe(kind);
  });

  it("is reported as not configured without a key, and never calls the API", async () => {
    const saved = process.env.CURRENCYAPI_KEY;
    delete process.env.CURRENCYAPI_KEY;
    try {
      const f = fakeFetch(() => ({ body: "{}" }));
      const b = new CurrencyApiAdapter({ fetch: f.fetch });
      expect(b.configured()).toBe(false);
      expect(await kindOf(b.getLatestRate("USD", "MXN"))).toBe("not_configured");
      expect(f.calls).toHaveLength(0);
    } finally {
      if (saved !== undefined) process.env.CURRENCYAPI_KEY = saved;
    }
  });

  it("an invalid response body is rejected", async () => {
    const { a } = capi(() => ({ body: '{"data":{"MXN":{"code":"MXN","value":19.6}}}' }));
    expect(await kindOf(a.getLatestRate("USD", "MXN"))).toBe("invalid_response");
  });
});

// ---------- benchmark selection ----------

const obs = (provider: FxObservation["provider"], rate: string, observedAt: string, over: Partial<FxObservation> = {}): FxResult => ({
  ok: true,
  observation: {
    provider,
    dataset: "x",
    base: "USD",
    quote: "MXN",
    rate,
    observedAt,
    observedDate: observedAt.slice(0, 10),
    retrievedAt: new Date(NOW).toISOString(),
    cached: false,
    sourceReference: "GET test",
    attribution: { label: provider },
    rawResponseHash: "0".repeat(64),
    rawText: "",
    ...over,
  },
});
const fail = (provider: FxObservation["provider"], kind: "outage" | "not_configured" = "outage"): FxResult => ({ ok: false, provider, base: "USD", quote: "MXN", kind, message: "down", retrievedAt: new Date(NOW).toISOString(), sourceReference: "GET test" });
const select = (r: FxResult[], policy = POLICY_V1) => selectBenchmark("USD", "MXN", r, NOW, RULES, policy);

describe("FX benchmark selection (policy fx-benchmark-v1)", () => {
  it("selects the primary source and preserves the secondary observation and the difference", () => {
    const s = select([obs("frankfurter", "19.6691", "2026-11-27T00:00:00Z"), obs("currencyapi", "19.6512", "2026-11-26T23:59:59Z")]);
    expect(s).toMatchObject({ selectedRate: "19.6691", selectedProvider: "frankfurter", secondaryRate: "19.6512", secondaryProvider: "currencyapi", freshness: "fresh", fallbackUsed: false, policyVersion: "fx-benchmark-v1" });
    expect(Number(s.differencePercentage)).toBeCloseTo(-0.091, 3);
    expect(s.warnings).toEqual([]);
  });

  it("falls back to the secondary ONLY under the explicit policy, and records it", () => {
    const s = select([fail("frankfurter"), obs("currencyapi", "19.6512", "2026-11-26T23:59:59Z")]);
    expect(s.selectedProvider).toBe("currencyapi");
    expect(s.fallbackUsed).toBe(true);
    expect(s.warnings.join(" ")).toMatch(/Fallback/);
    const strict = select([fail("frankfurter"), obs("currencyapi", "19.6512", "2026-11-26T23:59:59Z")], { ...POLICY_V1, allowFallback: false });
    expect(strict.selectedRate).toBeNull();
    expect(strict.freshness).toBe("unavailable");
  });

  it("a stale primary is not used; when nothing is usable there is no rate at all", () => {
    const s = select([obs("frankfurter", "19.0", "2026-11-20T00:00:00Z"), obs("currencyapi", "19.65", "2026-11-26T23:59:59Z")]);
    expect(s.selectedProvider).toBe("currencyapi");
    expect(s.warnings.join(" ")).toMatch(/stale/);
    const none = select([obs("frankfurter", "19.0", "2026-11-20T00:00:00Z"), fail("currencyapi", "not_configured")]);
    expect(none).toMatchObject({ selectedRate: null, selectedProvider: null, freshness: "unavailable" });
    expect(none.warnings.join(" ")).toMatch(/No usable reference rate/);
  });

  it("flags a material discrepancy without changing the selection", () => {
    const s = select([obs("frankfurter", "19.60", "2026-11-27T00:00:00Z"), obs("currencyapi", "19.80", "2026-11-27T00:00:00Z")]);
    expect(s.selectedRate).toBe("19.6");
    expect(s.warnings.join(" ")).toMatch(/Material discrepancy/);
  });

  it("rejects a wrong pair, a non-positive rate and a future-dated observation", () => {
    expect(select([obs("frankfurter", "19.6", "2026-11-27T00:00:00Z", { quote: "INR" })]).selectedRate).toBeNull();
    expect(select([obs("frankfurter", "0", "2026-11-27T00:00:00Z")]).selectedRate).toBeNull();
    expect(select([obs("frankfurter", "19.6", "2026-11-29T00:00:00Z")]).selectedRate).toBeNull();
  });

  it("aging observations are usable but flagged", () => {
    const s = select([obs("frankfurter", "19.6", "2026-11-24T00:00:00Z")]);
    expect(s.freshness).toBe("aging");
    expect(s.warnings.join(" ")).toMatch(/aging/);
  });

  it("property: never averages; the selected rate is always one source's own rate; deterministic", () => {
    const rate = fc.integer({ min: 1, max: 10_000_000 }).map((n) => (n / 10_000).toFixed(4));
    const age = fc.integer({ min: 0, max: 200 }).map((h) => new Date(NOW - h * 3_600_000).toISOString());
    const src = (p: FxObservation["provider"]) => fc.oneof(fc.constant(fail(p)), fc.tuple(rate, age).map(([r, a]) => obs(p, r, a)));
    fc.assert(
      fc.property(src("frankfurter"), src("currencyapi"), fc.boolean(), (a, b, allow) => {
        const policy = { ...POLICY_V1, allowFallback: allow };
        const s = select([a, b], policy);
        const own = [a, b].filter((r) => r.ok).map((r) => (r as Extract<FxResult, { ok: true }>).observation.rate);
        if (s.selectedRate !== null) {
          expect(own.map((x) => String(Number(x)))).toContain(String(Number(s.selectedRate)));
          expect(s.freshness).not.toBe("stale");
          if (s.selectedProvider === "currencyapi") expect(s.fallbackUsed && allow).toBe(true);
        }
        expect(JSON.stringify(select([a, b], policy))).toBe(JSON.stringify(s));
      }),
      { numRuns: 500 },
    );
  });

  it("freshness is judged on observation time, not retrieval time", () => {
    expect(observationFreshness("2026-11-27T00:00:00Z", NOW, RULES)).toBe("fresh");
    expect(observationFreshness("2026-11-24T00:00:00Z", NOW, RULES)).toBe("aging");
    expect(observationFreshness("2026-11-20T00:00:00Z", NOW, RULES)).toBe("stale");
    expect(observationFreshness(null, NOW, RULES)).toBe("unavailable");
  });
});

describe("HTTP resilience", () => {
  it("retries a 503 with backoff, then succeeds", async () => {
    const waits: number[] = [];
    const f = fakeFetch((_c, n) => (n < 3 ? { status: 503, body: "{}" } : { body: "[1]" }));
    const r = await requestJson({ provider: "p", url: "https://x.test/a", fetch: f.fetch, sleep: async (ms) => void waits.push(ms) });
    expect(r.status).toBe(200);
    expect(r.attempts).toBe(3);
    expect(waits).toHaveLength(2);
    expect(waits[1]).toBeGreaterThan(waits[0]);
  });

  it("honours Retry-After on 429 (capped)", async () => {
    const waits: number[] = [];
    const f = fakeFetch((_c, n) => (n === 1 ? { status: 429, body: "{}", headers: { "retry-after": "2" } } : { body: "{}" }));
    await requestJson({ provider: "p", url: "https://x.test/a", fetch: f.fetch, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([2000]);
  });

  it("does not retry a 4xx validation error", async () => {
    const f = fakeFetch(() => ({ status: 422, body: "{}" }));
    const r = await requestJson({ provider: "p", url: "https://x.test/a", fetch: f.fetch, sleep: noSleep });
    expect(r.status).toBe(422);
    expect(f.calls).toHaveLength(1);
  });

  it("opens the circuit after repeated transient failures, so the provider is not hammered", async () => {
    const f = fakeFetch(() => ({ status: 503, body: "{}" }));
    for (let i = 0; i < 5; i++) await requestJson({ provider: "flaky", url: "https://x.test/a", fetch: f.fetch, sleep: noSleep, retries: 0 });
    const before = f.calls.length;
    expect(await kindOf(requestJson({ provider: "flaky", url: "https://x.test/a", fetch: f.fetch, sleep: noSleep }))).toBe("circuit_open");
    expect(f.calls.length).toBe(before);
  });

  it("a non-JSON body is an invalid response", async () => {
    const f = fakeFetch(() => ({ body: "<html>gateway</html>" }));
    expect(await kindOf(requestJson({ provider: "p", url: "https://x.test/a", fetch: f.fetch, sleep: noSleep }))).toBe("invalid_response");
  });

  it("parses numbers as exact decimal text and redacts secrets from references", () => {
    expect(parseJsonExact('{"a":19.66910000000000000001,"b":15000.00}')).toEqual({ a: "19.66910000000000000001", b: "15000.00" });
    expect(safeReference("GET", "https://x.test/v3/latest?apikey=SECRET&currencies=MXN")).toBe("GET https://x.test/v3/latest?apikey=REDACTED&currencies=MXN");
  });
});
