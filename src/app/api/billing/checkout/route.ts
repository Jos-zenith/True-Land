import crypto from "node:crypto";
import { route } from "@/server/http";
import { ServiceError } from "@/server/core";
import { providers } from "@/server/integrations/service";
import { IntegrationError } from "@/server/integrations/http";

export const dynamic = "force-dynamic";

/**
 * Start a Stripe Checkout session for THIS workspace's subscription (administrators only). The redirect
 * back is never trusted as payment proof: only verified webhooks change billing state.
 */
export const POST = route("members:manage", async ({ req, auth }) => {
  const stripe = providers().stripe;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!stripe.configured() || !priceId) throw new ServiceError(503, "BILLING_NOT_CONFIGURED", "Billing is not configured on this deployment.");
  const origin = new URL(req.url).origin;
  try {
    const s = await stripe.createCheckoutSession({
      priceId,
      workspaceId: auth.workspaceId,
      successUrl: `${origin}/settings?billing=returned`,
      cancelUrl: `${origin}/settings?billing=cancelled`,
      idempotencyKey: `checkout-${auth.workspaceId}-${crypto.randomUUID()}`,
    });
    return { url: s.url };
  } catch (e) {
    if (e instanceof IntegrationError) throw new ServiceError(502, `STRIPE_${e.kind.toUpperCase()}`, e.message);
    throw e;
  }
});
