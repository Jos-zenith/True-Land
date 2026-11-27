import { z } from "zod";
import { amountProblem, currencyInfo } from "../currency";
import { IntegrationError, requestJson } from "../http";
import type { ProviderQuote, QuoteProvider, QuoteRequest } from "./types";

/**
 * Wise Platform API, QUOTES ONLY. This adapter never creates recipients or transfers, and never
 * touches balances.
 *
 * Hosts (docs 2026Q4): production https://api.wise.com/2026Q4, sandbox https://api.wise-sandbox.com/2026Q4.
 *   Authenticated:   POST /profiles/{profileId}/quotes   Authorization: Bearer <user token>
 *                    Profile-specific. The rate is locked for 30 minutes (expirationTime).
 *   Unauthenticated: POST /quotes                        no token
 *                    "example quotes for illustrative purposes"; no usable id; cannot create a transfer.
 * Request: { sourceCurrency, targetCurrency, sourceAmount | targetAmount (never both), payOut?, preferredPayIn? }
 * The response shape was confirmed against the live unauthenticated endpoint on 2026-11-27
 * (fixture wise-unauthenticated-usd-mxn-15000.json). Per Wise's guidance, the fee shown is
 * paymentOption.price.total.value, with price.items as the breakdown.
 */
const money = z.object({ amount: z.string(), currency: z.string() });
const option = z.object({
  disabled: z.boolean(),
  disabledReason: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
  payIn: z.string(),
  payOut: z.string(),
  sourceAmount: z.string().optional(),
  targetAmount: z.string().optional(),
  sourceCurrency: z.string().optional(),
  targetCurrency: z.string().optional(),
  estimatedDelivery: z.string().optional(),
  formattedEstimatedDelivery: z.string().optional(),
  fee: z.object({ total: z.string() }).partial().optional(),
  price: z
    .object({
      total: z.object({ value: money }),
      items: z.array(z.object({ label: z.string().optional(), type: z.string().optional(), value: money })).optional(),
    })
    .optional(),
});
const quote = z.object({
  id: z.string().optional(),
  sourceCurrency: z.string(),
  targetCurrency: z.string(),
  sourceAmount: z.string().nullable().optional(),
  targetAmount: z.string().nullable().optional(),
  rate: z.string(),
  rateType: z.string().optional(),
  createdTime: z.string().optional(),
  expirationTime: z.string().optional(),
  rateExpirationTime: z.string().optional(),
  status: z.string().optional(),
  paymentOptions: z.array(option),
  notices: z.array(z.object({ text: z.string().optional(), type: z.string().optional() })).optional(),
});

export interface WiseOptions {
  baseUrl?: string; // e.g. https://api.wise.com
  version?: string; // e.g. 2026Q4
  token?: string;
  profileId?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const MAX_AMOUNT = "10000000";

export class WiseAdapter implements QuoteProvider {
  readonly id = "wise";
  private root: string;
  private token?: string;
  private profileId?: string;
  constructor(private o: WiseOptions = {}) {
    const base = (o.baseUrl ?? process.env.WISE_API_BASE_URL ?? "https://api.wise.com").replace(/\/+$/, "");
    const version = o.version ?? process.env.WISE_API_VERSION ?? "2026Q4";
    this.root = `${base}/${version}`;
    this.token = o.token ?? process.env.WISE_ACCESS_TOKEN ?? undefined;
    this.profileId = o.profileId ?? process.env.WISE_PROFILE_ID ?? undefined;
  }

  /** Authenticated needs BOTH a token and a profile. Without them, only illustrative quotes. */
  mode(): "authenticated" | "unauthenticated" {
    return this.token && this.profileId ? "authenticated" : "unauthenticated";
  }

  /** A token without a profile is a configuration error, not a reason to silently downgrade. */
  configurationProblem(): string | null {
    if (this.token && !this.profileId) return "WISE_ACCESS_TOKEN is set but WISE_PROFILE_ID is missing: authenticated quotes need a profile.";
    if (this.profileId && !/^\d+$/.test(this.profileId)) return "WISE_PROFILE_ID must be the numeric profile id.";
    return null;
  }

  validate(req: QuoteRequest) {
    if (!!req.sourceAmount === !!req.targetAmount) throw new IntegrationError(this.id, "invalid_request", "Give either a source amount or a target amount, not both.");
    for (const c of [req.sourceCurrency, req.targetCurrency]) if (!currencyInfo(c)) throw new IntegrationError(this.id, "unsupported_currency", `${c} is not a supported currency.`);
    const [amt, cur] = req.sourceAmount ? [req.sourceAmount, req.sourceCurrency] : [req.targetAmount!, req.targetCurrency];
    const p = amountProblem(amt, cur);
    if (p) throw new IntegrationError(this.id, "invalid_request", p);
    if (Number(amt) > Number(MAX_AMOUNT)) throw new IntegrationError(this.id, "invalid_request", `Amount is above the ${MAX_AMOUNT} limit for quote requests.`);
  }

  async getQuote(req: QuoteRequest): Promise<ProviderQuote> {
    const problem = this.configurationProblem();
    if (problem) throw new IntegrationError(this.id, "not_configured", problem);
    this.validate(req);
    const authed = this.mode() === "authenticated";
    const url = authed ? `${this.root}/profiles/${this.profileId}/quotes` : `${this.root}/quotes`;
    // Amounts are sent as JSON numbers built from the validated decimal text (no float arithmetic).
    const amount = req.sourceAmount ? `"sourceAmount":${req.sourceAmount}` : `"targetAmount":${req.targetAmount}`;
    const extras = authed ? `,"payOut":${JSON.stringify(req.payOut ?? "BANK_TRANSFER")},"preferredPayIn":${JSON.stringify(req.payIn ?? "BANK_TRANSFER")}` : "";
    const body = `{"sourceCurrency":${JSON.stringify(req.sourceCurrency)},"targetCurrency":${JSON.stringify(req.targetCurrency)},${amount}${extras}}`;
    const res = await requestJson({
      provider: this.id,
      url,
      method: "POST",
      headers: { "content-type": "application/json", ...(authed ? { authorization: `Bearer ${this.token}` } : {}) },
      body,
      retries: 1, // a duplicate quote is harmless: quotes never move money
      fetch: this.o.fetch,
      sleep: this.o.sleep,
      now: this.o.now,
    });
    const retrievedAt = new Date((this.o.now ?? Date.now)()).toISOString();
    if (res.status !== 200) {
      const text = res.text.slice(0, 2000);
      if ((res.status === 400 || res.status === 422) && /targetAccount|recipient/i.test(text)) {
        return this.incomplete(req, retrievedAt, authed, res.hash, res.text);
      }
      if (res.status === 401) throw new IntegrationError(this.id, "authentication", "Wise rejected the access token.", 401);
      if (res.status === 403) throw new IntegrationError(this.id, "permission", "Wise refused the request for this profile (permission).", 403);
      if (res.status === 404) throw new IntegrationError(this.id, "missing_data", authed ? "Wise did not find the profile. Check WISE_PROFILE_ID." : "Wise quote endpoint not found. Check WISE_API_BASE_URL and WISE_API_VERSION.", 404);
      if (res.status === 429) throw new IntegrationError(this.id, "rate_limit", "Wise rate limit reached. Try again shortly.", 429);
      if (res.status >= 500) throw new IntegrationError(this.id, "outage", `Wise is unavailable (HTTP ${res.status}).`, res.status);
      const unsupported = /currency|route|not supported|unsupported/i.test(text);
      throw new IntegrationError(this.id, unsupported ? "unsupported_currency" : "invalid_request", `Wise refused the quote request (HTTP ${res.status}).`, res.status);
    }
    const parsed = quote.safeParse(res.body);
    if (!parsed.success) throw new IntegrationError(this.id, "invalid_response", "Wise returned an unexpected quote shape.");
    return this.normalise(parsed.data, req, authed, retrievedAt, res.hash, res.text);
  }

  private incomplete(req: QuoteRequest, retrievedAt: string, authed: boolean, hash: string, text: string): ProviderQuote {
    return {
      provider: this.id,
      sourceCurrency: req.sourceCurrency,
      targetCurrency: req.targetCurrency,
      sourceAmount: req.sourceAmount,
      targetAmount: req.targetAmount,
      feeBreakdown: [],
      quoteStatus: "requires_recipient",
      notices: [{ type: "INFO", text: "Wise needs recipient details for this quote. Landed does not hold or send recipient banking details." }],
      disabledOptions: [],
      evidenceClassification: authed ? "authenticated_quote" : "unauthenticated_quote",
      retrievedAt,
      rawResponseReference: hash,
      rawText: text,
    };
  }

  normalise(q: z.infer<typeof quote>, req: QuoteRequest, authed: boolean, retrievedAt: string, hash: string, text: string): ProviderQuote {
    if (q.sourceCurrency !== req.sourceCurrency || q.targetCurrency !== req.targetCurrency) {
      throw new IntegrationError(this.id, "invalid_response", `Wise quoted ${q.sourceCurrency}→${q.targetCurrency}, not ${req.sourceCurrency}→${req.targetCurrency}.`);
    }
    const wantIn = req.payIn ?? "BANK_TRANSFER";
    const wantOut = req.payOut ?? "BANK_TRANSFER";
    const enabled = q.paymentOptions.filter((p) => !p.disabled);
    const chosen = enabled.find((p) => p.payIn === wantIn && p.payOut === wantOut) ?? null;
    const disabledOptions = q.paymentOptions.filter((p) => p.disabled).map((p) => ({ payIn: p.payIn, payOut: p.payOut, reason: p.disabledReason?.message ?? p.disabledReason?.code ?? "disabled" }));
    const notices = (q.notices ?? []).map((n) => ({ type: n.type ?? "INFO", text: n.text ?? "" }));
    const blocked = notices.some((n) => n.type === "BLOCKED");
    const base: ProviderQuote = {
      provider: this.id,
      // Unauthenticated quotes carry no usable id and can never create a transfer.
      quoteId: authed ? q.id : undefined,
      sourceCurrency: q.sourceCurrency,
      targetCurrency: q.targetCurrency,
      exchangeRate: q.rate,
      rateType: q.rateType,
      quoteCreatedAt: q.createdTime,
      quoteExpiresAt: q.expirationTime,
      rateExpiresAt: q.rateExpirationTime,
      feeBreakdown: [],
      quoteStatus: blocked ? "blocked" : chosen ? "available" : "no_enabled_option",
      notices,
      disabledOptions,
      evidenceClassification: authed ? "authenticated_quote" : "unauthenticated_quote",
      retrievedAt,
      rawResponseReference: hash,
      rawText: text,
      payInMethod: chosen?.payIn ?? wantIn,
      payOutMethod: chosen?.payOut ?? wantOut,
    };
    if (!chosen) return { ...base, sourceAmount: q.sourceAmount ?? req.sourceAmount, targetAmount: undefined };
    const total = chosen.price?.total.value ?? (chosen.fee?.total ? { amount: chosen.fee.total, currency: q.sourceCurrency } : null);
    return {
      ...base,
      sourceAmount: chosen.sourceAmount ?? q.sourceAmount ?? undefined,
      targetAmount: chosen.targetAmount ?? q.targetAmount ?? undefined,
      totalFee: total?.amount,
      feeCurrency: total?.currency,
      feeBreakdown: (chosen.price?.items ?? []).map((i) => ({ label: i.label ?? i.type ?? "fee", amount: i.value.amount, currency: i.value.currency })),
      deliveryEstimate: chosen.estimatedDelivery,
      deliveryEstimateText: chosen.formattedEstimatedDelivery,
    };
  }
}
