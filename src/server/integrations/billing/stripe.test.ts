import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fakeFetch, noSleep } from "@/test/fakes";
import { call, freshDatabase, newTenant, type Tenant } from "@/test/harness";
import { resetCircuitBreakers } from "../http";
import { billingFor } from "../store";
import { getSql } from "../../db";
import { signStripePayload, StripeAdapter, verifyStripeSignature, type StripeEvent } from "./stripe";
import * as webhook from "@/app/api/billing/stripe/webhook/route";

const SECRET = "whsec_test_0123456789abcdef";
const NOW = 1_800_000_000;

describe("webhook signature verification", () => {
  const body = '{"id":"evt_1","type":"invoice.paid"}';
  it("accepts a valid signature, including when several v1 signatures are present", () => {
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, NOW), SECRET, NOW)).toBe(true);
    const h = `${signStripePayload(body, SECRET, NOW)},v1=${"0".repeat(64)}`;
    expect(verifyStripeSignature(body, h, SECRET, NOW)).toBe(true);
  });
  it("rejects a wrong secret, a modified body, an old timestamp and malformed headers", () => {
    expect(verifyStripeSignature(body, signStripePayload(body, "whsec_other", NOW), SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body + " ", signStripePayload(body, SECRET, NOW), SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, signStripePayload(body, SECRET, NOW - 301), SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, null, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, "t=abc,v1=zz", SECRET, NOW)).toBe(false);
  });
});

describe("Stripe adapter (test mode first)", () => {
  it("creates a subscription checkout session with an idempotency key and the workspace reference", async () => {
    resetCircuitBreakers();
    const f = fakeFetch(() => ({ body: '{"id":"cs_test_1","url":"https://checkout.stripe.com/c/pay/cs_test_1"}' }));
    const s = new StripeAdapter({ secretKey: "sk_test_abc", fetch: f.fetch });
    const r = await s.createCheckoutSession({ priceId: "price_123", workspaceId: "ws_1", successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no", idempotencyKey: "idem-1" });
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
    const c = f.calls[0];
    expect(c.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(c.headers.get("authorization")).toBe("Bearer sk_test_abc");
    expect(c.headers.get("idempotency-key")).toBe("idem-1");
    const form = new URLSearchParams(c.body!);
    expect(form.get("mode")).toBe("subscription");
    expect(form.get("client_reference_id")).toBe("ws_1");
    expect(form.get("line_items[0][price]")).toBe("price_123");
  });

  it("refuses a live key unless live billing is explicitly enabled", async () => {
    const s = new StripeAdapter({ secretKey: "sk_live_abc", fetch: fakeFetch(() => ({ body: "{}" })).fetch, allowLive: false });
    expect(s.environment()).toBe("live");
    await expect(s.createCheckoutSession({ priceId: "price_1", workspaceId: "w", successUrl: "https://a", cancelUrl: "https://b", idempotencyKey: "k" })).rejects.toThrow(/test key first/);
  });

  it("reports an authentication failure", async () => {
    resetCircuitBreakers();
    const s = new StripeAdapter({ secretKey: "sk_test_bad", fetch: fakeFetch(() => ({ status: 401, body: '{"error":{"message":"Invalid API Key"}}' })).fetch });
    await expect(s.createCheckoutSession({ priceId: "price_1", workspaceId: "w", successUrl: "https://a", cancelUrl: "https://b", idempotencyKey: "k" })).rejects.toMatchObject({ kind: "authentication" });
  });
});

describe("webhook processing (database, idempotent, separate from payment checks)", () => {
  let T: Tenant;
  beforeAll(async () => {
    await freshDatabase();
    T = await newTenant("billing");
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });
  afterAll(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  const send = (e: StripeEvent, sig?: string) => {
    const body = JSON.stringify(e);
    const t = Math.floor(Date.now() / 1000);
    return webhook.POST(new Request("https://landed.test/api/billing/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": sig ?? signStripePayload(body, SECRET, t) } }));
  };
  const ev = (id: string, type: string, object: Record<string, unknown>): StripeEvent => ({ id, type, livemode: false, data: { object } });

  it("rejects an invalid signature and changes nothing", async () => {
    const r = await send(ev("evt_bad", "invoice.paid", { customer: "cus_1" }), "t=1,v1=" + "a".repeat(64));
    expect(r.status).toBe(400);
    expect((await (await getSql()).query("SELECT count(*)::int n FROM stripe_events")).rows[0]).toEqual({ n: 0 });
  });

  it("checkout completed → subscription active → payment failed → cancelled; duplicates are no-ops", async () => {
    const completed = ev("evt_1", "checkout.session.completed", { client_reference_id: T.workspaceId, customer: "cus_1", subscription: "sub_1" });
    const r1 = await send(completed);
    expect(await r1.json()).toMatchObject({ received: true, duplicate: false, outcome: "applied" });
    expect((await billingFor(T.workspaceId))?.status).toBe("pending_activation"); // redirect/checkout alone is not proof of payment

    const dup = await send(completed);
    expect(await dup.json()).toMatchObject({ duplicate: true });

    await send(ev("evt_2", "customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "active", current_period_end: 1_900_000_000, metadata: { workspace_id: T.workspaceId } }));
    expect(await billingFor(T.workspaceId)).toMatchObject({ status: "active", currentPeriodEnd: new Date(1_900_000_000_000).toISOString() });

    await send(ev("evt_3", "invoice.payment_failed", { customer: "cus_1", subscription: "sub_1" }));
    expect((await billingFor(T.workspaceId))?.status).toBe("past_due");

    await send(ev("evt_4", "customer.subscription.deleted", { id: "sub_1", customer: "cus_1", status: "canceled", metadata: { workspace_id: T.workspaceId } }));
    expect((await billingFor(T.workspaceId))?.status).toBe("canceled");

    const sql = await getSql();
    expect((await sql.query("SELECT count(*)::int n FROM stripe_events")).rows[0]).toEqual({ n: 4 });
    // Billing never touches payment-check history.
    expect((await sql.query("SELECT count(*)::int n FROM audit_events WHERE message ILIKE '%stripe%'")).rows[0]).toEqual({ n: 0 });
  });

  it("an event for an unknown customer is recorded but applies nothing", async () => {
    const r = await send(ev("evt_x", "invoice.paid", { customer: "cus_unknown" }));
    expect(await r.json()).toMatchObject({ outcome: "unmatched" });
  });

  it("stripe event records are append-only", async () => {
    await expect((await getSql()).query("DELETE FROM stripe_events")).rejects.toThrow(/append-only/);
  });

  it("without a webhook secret the endpoint refuses everything", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const r = await send(ev("evt_9", "invoice.paid", {}));
    expect(r.status).toBe(503);
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });
});

void noSleep;
