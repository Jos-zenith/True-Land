/**
 * A provider's quote, normalised. Decimal values are exact strings. A quote is evidence of what a
 * provider offered at a moment: it is not a guaranteed supplier receipt, and an expired quote is
 * never reused for comparison.
 */
export type QuoteStatus =
  | "available" // an enabled payment option matched the request
  | "no_enabled_option" // the provider reports every relevant option as disabled
  | "blocked" // a BLOCKED notice: must not be used
  | "requires_recipient" // the provider needs recipient details Landed does not hold
  | "expired";

export interface ProviderQuote {
  provider: string;
  quoteId?: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount?: string;
  targetAmount?: string;
  exchangeRate?: string;
  rateType?: string;
  totalFee?: string;
  feeCurrency?: string;
  feeBreakdown: { label: string; amount: string; currency: string }[];
  deliveryEstimate?: string;
  deliveryEstimateText?: string;
  quoteCreatedAt?: string;
  quoteExpiresAt?: string;
  rateExpiresAt?: string;
  quoteStatus: QuoteStatus;
  payInMethod?: string;
  payOutMethod?: string;
  notices: { type: string; text: string }[];
  disabledOptions: { payIn: string; payOut: string; reason: string }[];
  evidenceClassification: "authenticated_quote" | "unauthenticated_quote" | "manual" | "unavailable";
  retrievedAt: string;
  rawResponseReference?: string; // payload hash
  rawText?: string;
}

export interface QuoteRequest {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount?: string;
  targetAmount?: string;
  payIn?: string;
  payOut?: string;
}

export interface QuoteProvider {
  readonly id: string;
  mode(): "authenticated" | "unauthenticated" | "not_configured";
  getQuote(req: QuoteRequest): Promise<ProviderQuote>;
}

/** An expired quote must not be reused: callers check this at READ time, not only at retrieval. */
export function effectiveQuoteStatus(q: Pick<ProviderQuote, "quoteStatus" | "quoteExpiresAt">, nowMs: number): QuoteStatus {
  if (q.quoteExpiresAt && new Date(q.quoteExpiresAt).getTime() <= nowMs) return "expired";
  return q.quoteStatus;
}
