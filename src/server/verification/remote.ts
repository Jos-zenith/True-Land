import crypto from "node:crypto";
import { z } from "zod";
import { dec, isValidClabe } from "@/engine";
import { fmtMoney } from "@/lib/format";
import { ServiceError } from "../core";
import type { ReceiptClaim, ReceiptVerifier, VerificationResult } from "./types";

/**
 * LIVE receipt verification through a deployer-operated HTTPS service.
 *
 * Contract (documented in docs/verification.md):
 *   POST <endpoint>
 *     headers: content-type: application/json
 *              x-landed-timestamp: <unix ms>
 *              x-landed-signature: hex HMAC-SHA-256(secret, "<timestamp>.<body>")
 *     body:    { trackingKey, date, sendingBank, receivingBank, amount, beneficiaryAccount }
 *   200 response, signed the same way with the same secret:
 *     { status: "found", reference, cep: { amount, date, sendingBank, receivingBank } }
 *   | { status: "not_found", reference }
 *   | { status: "unreadable", reference, reason }
 *
 * This adapter authenticates the response (signature, 5-minute freshness), validates its shape and
 * compares the official amount with the claimed one using decimal arithmetic. It does NOT talk to
 * Banxico itself: that service is out of scope for this repository and has not been built.
 */
const responseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("found"),
    reference: z.string().min(1).max(120),
    cep: z.object({
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      sendingBank: z.string().min(1).max(80),
      receivingBank: z.string().min(1).max(80),
    }),
  }),
  z.object({ status: z.literal("not_found"), reference: z.string().max(120) }),
  z.object({ status: z.literal("unreadable"), reference: z.string().max(120), reason: z.string().max(200) }),
]);

export function sign(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

const unavailable = (msg: string) => new ServiceError(502, "VERIFIER_ERROR", `Receipt verification is unavailable: ${msg} Nothing was recorded.`);

export class RemoteCepVerifier implements ReceiptVerifier {
  readonly mode = "live" as const;
  readonly provider: string;
  constructor(
    private opts: { endpoint: string; secret: string; fetch?: typeof fetch; timeoutMs?: number; now?: () => number },
  ) {
    const u = new URL(opts.endpoint);
    if (u.protocol !== "https:" && !(u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      throw new Error("The verification endpoint must use HTTPS.");
    }
    if (opts.secret.length < 32) throw new Error("The verification secret must be at least 32 characters.");
    this.provider = `remote:${u.host}`;
  }

  async verify(claim: ReceiptClaim, ctx: { checkId: string }): Promise<VerificationResult> {
    const base = { mode: "live" as const, provider: this.provider, demo: null, fileName: `cep-${ctx.checkId.slice(4)}-${claim.trackingKey ?? "no-key"}` };
    if (claim.beneficiaryAccount && !isValidClabe(claim.beneficiaryAccount)) {
      return { ...base, result: "invalid_account", file: null, providerRef: null, detail: "The beneficiary account is not a valid CLABE (check digit fails). Not verified." };
    }
    if (!claim.trackingKey) throw new ServiceError(422, "VALIDATION", "A tracking key (clave de rastreo) is required for a live check.", { trackingKey: "Enter the tracking key." });
    const now = this.opts.now ?? Date.now;
    const body = JSON.stringify({
      trackingKey: claim.trackingKey,
      date: claim.date,
      sendingBank: claim.sendingBank,
      receivingBank: claim.receivingBank,
      amount: claim.amount,
      beneficiaryAccount: claim.beneficiaryAccount,
    });
    const ts = String(now());
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(this.opts.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-landed-timestamp": ts, "x-landed-signature": sign(this.opts.secret, ts, body) },
        body,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw unavailable("the provider did not respond.");
    }
    const text = await res.text();
    if (!res.ok) throw unavailable(`the provider answered HTTP ${res.status}.`);
    const rts = res.headers.get("x-landed-timestamp") ?? "";
    const rsig = res.headers.get("x-landed-signature") ?? "";
    if (!safeEqualHex(rsig, sign(this.opts.secret, rts, text))) throw unavailable("the provider's answer is not authentic.");
    if (!/^\d+$/.test(rts) || Math.abs(now() - Number(rts)) > 5 * 60_000) throw unavailable("the provider's answer is stale.");
    let parsed: z.infer<typeof responseSchema>;
    try {
      parsed = responseSchema.parse(JSON.parse(text));
    } catch {
      throw unavailable("the provider's answer is malformed.");
    }
    if (parsed.status === "not_found") {
      return { ...base, result: "not_found", file: null, providerRef: parsed.reference, detail: "No receipt was found for these details. Not verified." };
    }
    if (parsed.status === "unreadable") {
      return { ...base, result: "unreadable", file: null, providerRef: parsed.reference, detail: `The receipt could not be read: ${parsed.reason}` };
    }
    const file = parsed.cep;
    const ok = dec(file.amount).eq(dec(claim.amount)) && file.date === claim.date;
    return {
      ...base,
      result: ok ? "verified" : "mismatch",
      file,
      providerRef: parsed.reference,
      detail: ok
        ? "The official receipt matches the amount and date."
        : `Receipt: ${fmtMoney(file.amount, "MXN")} on ${file.date}. Entered: ${fmtMoney(claim.amount, "MXN")} on ${claim.date}. Not verified.`,
    };
  }
}
