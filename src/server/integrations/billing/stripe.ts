import crypto from "node:crypto";
import { IntegrationError, requestJson } from "../http";

/**
 * Stripe, for Landed's OWN SaaS subscription billing only. It is never used as a supplier-payment
 * route, an FX source or a payout rail (Global Payouts is out of scope: see docs/integrations.md).
 * Billing state is kept in billing_subscriptions / stripe_events and never mixed with payment checks.
 *
 *   POST https://api.stripe.com/v1/checkout/sessions   (form-encoded, Bearer secret key, Idempotency-Key)
 *   Webhooks: header `Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>[,v1=…]`
 * A browser redirect to the success URL is never treated as proof of payment; only verified webhooks
 * change billing state.
 */
export interface StripeOptions {
  secretKey?: string;
  allowLive?: boolean;
  fetch?: typeof fetch;
  now?: () => number;
}

export class StripeAdapter {
  readonly id = "stripe";
  private key?: string;
  constructor(private o: StripeOptions = {}) {
    this.key = o.secretKey ?? process.env.STRIPE_SECRET_KEY ?? undefined;
  }

  configured(): boolean {
    return !!this.key;
  }

  environment(): "test" | "live" | "not_configured" {
    if (!this.key) return "not_configured";
    return this.key.startsWith("sk_test_") || this.key.startsWith("rk_test_") ? "test" : "live";
  }

  private requireKey(): string {
    if (!this.key) throw new IntegrationError(this.id, "not_configured", "Stripe is not configured (STRIPE_SECRET_KEY is not set).");
    if (this.environment() === "live" && !(this.o.allowLive ?? process.env.LANDED_STRIPE_ALLOW_LIVE === "1")) {
      throw new IntegrationError(this.id, "permission", "A live Stripe key is set but live billing is not enabled (LANDED_STRIPE_ALLOW_LIVE=1). Use a test key first.");
    }
    return this.key;
  }

  async createCheckoutSession(p: { priceId: string; workspaceId: string; customerEmail?: string; successUrl: string; cancelUrl: string; idempotencyKey: string }): Promise<{ id: string; url: string }> {
    const key = this.requireKey();
    if (!/^price_[A-Za-z0-9]+$/.test(p.priceId)) throw new IntegrationError(this.id, "invalid_request", "STRIPE_PRICE_ID must be a Stripe price id (price_…).");
    const form = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": p.priceId,
      "line_items[0][quantity]": "1",
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      client_reference_id: p.workspaceId,
      "subscription_data[metadata][workspace_id]": p.workspaceId,
    });
    if (p.customerEmail) form.set("customer_email", p.customerEmail);
    const res = await requestJson({
      provider: this.id,
      url: "https://api.stripe.com/v1/checkout/sessions",
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": p.idempotencyKey },
      body: form.toString(),
      retries: 1, // safe: the idempotency key makes a retry return the same session
      fetch: this.o.fetch,
      now: this.o.now,
    });
    if (res.status === 401) throw new IntegrationError(this.id, "authentication", "Stripe rejected the secret key.", 401);
    if (res.status !== 200) {
      const msg = (res.body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
      throw new IntegrationError(this.id, res.status === 429 ? "rate_limit" : res.status >= 500 ? "outage" : "invalid_request", `Stripe: ${msg}`, res.status);
    }
    const b = res.body as { id?: string; url?: string };
    if (!b.id || !b.url) throw new IntegrationError(this.id, "invalid_response", "Stripe returned a checkout session without an id or URL.");
    return { id: b.id, url: b.url };
  }
}

/** Verify a webhook signature. Constant-time comparison; rejects timestamps outside the tolerance. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec: number, toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest();
  return sigs.some((s) => /^[0-9a-f]{64}$/.test(s) && crypto.timingSafeEqual(Buffer.from(s, "hex"), expected));
}

export function signStripePayload(payload: string, secret: string, t: number): string {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex")}`;
}

export interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

/** Map a verified Stripe event to a billing-state change. Pure: the caller persists it idempotently. */
export function billingChange(e: StripeEvent): { workspaceId?: string; customerId?: string; subscriptionId?: string; status?: string; periodEnd?: string } | null {
  const o = e.data.object;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (e.type) {
    case "checkout.session.completed":
      return { workspaceId: str(o.client_reference_id), customerId: str(o.customer), subscriptionId: str(o.subscription), status: "pending_activation" };
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const meta = (o.metadata ?? {}) as Record<string, unknown>;
      const end = o.current_period_end;
      return {
        workspaceId: str(meta.workspace_id),
        customerId: str(o.customer),
        subscriptionId: str(o.id),
        status: e.type === "customer.subscription.deleted" ? "canceled" : str(o.status),
        periodEnd: typeof end === "string" || typeof end === "number" ? new Date(Number(end) * 1000).toISOString() : undefined,
      };
    }
    case "invoice.payment_failed":
      return { customerId: str(o.customer), subscriptionId: str(o.subscription), status: "past_due" };
    case "invoice.paid":
      return { customerId: str(o.customer), subscriptionId: str(o.subscription), status: "active" };
    default:
      return null;
  }
}
