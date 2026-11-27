import { describe, it, expect } from "vitest";
import { analyseProviderQuote, dec } from "@/engine";
import { FrankfurterAdapter } from "./fx/frankfurter";
import { CurrencyApiAdapter } from "./fx/currencyapi";
import { WiseAdapter } from "./quotes/wise";
import { StripeAdapter } from "./billing/stripe";

/**
 * LIVE integration tests against the real APIs. Opt-in:  LIVE_INTEGRATION_TESTS=1 npm test -- live
 * A provider counts as "live tested" only when its block ran and passed, not merely because a key exists.
 * Credentialed blocks run only when their credentials are present.
 */
const LIVE = process.env.LIVE_INTEGRATION_TESTS === "1";

describe.skipIf(!LIVE)("live: Frankfurter (public, no key)", () => {
  const f = new FrankfurterAdapter();
  it.each(["MXN", "INR"])("latest USD/%s is a fresh, positive, attributed reference rate", async (q) => {
    const o = await f.getLatestRate("USD", q);
    expect(dec(o.rate).gt(0)).toBe(true);
    expect(Date.now() - Date.parse(o.observedAt)).toBeLessThan(5 * 86_400_000);
    expect(o.attribution.contributors?.length ?? 0).toBeGreaterThan(0);
    console.log(`[live] Frankfurter USD/${q} ${o.rate} observed ${o.observedDate} (${o.attribution.contributors?.length} contributors)`);
  });
  it("historical USD/MXN", async () => {
    const o = await f.getHistoricalRate("USD", "MXN", "2026-11-20");
    expect(o.observedDate <= "2026-11-20").toBe(true);
  });
});

describe.skipIf(!LIVE)("live: Wise unauthenticated quotes (illustrative pricing)", () => {
  const w = new WiseAdapter({ token: "", profileId: "" });
  it.each(["5000", "15000", "50000"])("USD→MXN %s USD returns an available bank-transfer quote that is arithmetically consistent", async (amt) => {
    const q = await w.getQuote({ sourceCurrency: "USD", targetCurrency: "MXN", sourceAmount: amt });
    expect(q.evidenceClassification).toBe("unauthenticated_quote");
    expect(q.quoteStatus).toBe("available");
    const an = analyseProviderQuote({ sourceAmount: q.sourceAmount!, targetAmount: q.targetAmount!, providerRate: q.exchangeRate!, fee: q.totalFee!, feeCurrency: q.feeCurrency!, sourceCurrency: "USD", benchmarkRate: q.exchangeRate! });
    expect(dec(an.arithmeticCheck!).abs().lte("0.05")).toBe(true);
    console.log(`[live] Wise USD ${amt}: rate ${q.exchangeRate}, fee ${q.totalFee} ${q.feeCurrency}, target MXN ${q.targetAmount}, delivery ${q.deliveryEstimateText}, expires ${q.quoteExpiresAt}`);
  });
});

describe.skipIf(!LIVE || !process.env.CURRENCYAPI_KEY)("live: currencyapi.com (needs CURRENCYAPI_KEY)", () => {
  it("latest USD/MXN and quota status", async () => {
    const c = new CurrencyApiAdapter();
    const o = await c.getLatestRate("USD", "MXN");
    expect(dec(o.rate).gt(0)).toBe(true);
    const quota = await c.getQuota();
    console.log(`[live] CurrencyAPI USD/MXN ${o.rate} observed ${o.observedAt}; quota ${quota.used}/${quota.total}`);
  });
});

describe.skipIf(!LIVE || !process.env.WISE_ACCESS_TOKEN || !process.env.WISE_PROFILE_ID)("live: Wise authenticated (needs WISE_ACCESS_TOKEN + WISE_PROFILE_ID)", () => {
  it("authenticated USD→MXN quote for $15,000", async () => {
    const q = await new WiseAdapter().getQuote({ sourceCurrency: "USD", targetCurrency: "MXN", sourceAmount: "15000" });
    expect(q.evidenceClassification).toBe("authenticated_quote");
    expect(q.quoteId).toBeTruthy();
  });
});

describe.skipIf(!LIVE || !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") || !process.env.STRIPE_PRICE_ID)("live: Stripe test mode (needs sk_test_ key + STRIPE_PRICE_ID)", () => {
  it("creates a test-mode checkout session", async () => {
    const s = await new StripeAdapter().createCheckoutSession({ priceId: process.env.STRIPE_PRICE_ID!, workspaceId: "ws_live_test", successUrl: "https://example.com/ok", cancelUrl: "https://example.com/no", idempotencyKey: `live-${Date.now()}` });
    expect(s.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
  });
});
