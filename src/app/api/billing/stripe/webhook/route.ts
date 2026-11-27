import { NextResponse } from "next/server";
import { verifyStripeSignature, type StripeEvent } from "@/server/integrations/billing/stripe";
import { processStripeEvent, recordEvent } from "@/server/integrations/store";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Authenticated by signature (no session, no Origin check: Stripe is not a browser).
 * Idempotent: duplicate deliveries are acknowledged and ignored.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "BILLING_NOT_CONFIGURED" } }, { status: 503 });
  const payload = await req.text();
  const at = new Date().toISOString();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret, Math.floor(Date.now() / 1000))) {
    await recordEvent({ provider: "stripe", eventType: "webhook", requestReference: "POST /api/billing/stripe/webhook", status: "failure", errorCode: "authentication", at, environment: "webhook" });
    return NextResponse.json({ error: { code: "BAD_SIGNATURE" } }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
    if (typeof event.id !== "string" || typeof event.type !== "string") throw new Error();
  } catch {
    return NextResponse.json({ error: { code: "BAD_PAYLOAD" } }, { status: 400 });
  }
  const r = await processStripeEvent(event, at);
  await recordEvent({ provider: "stripe", eventType: `webhook.${event.type}`, requestReference: `event ${event.id}`, status: "success", at, environment: event.livemode ? "live" : "test" });
  return NextResponse.json({ received: true, duplicate: r.duplicate, outcome: r.outcome });
}
