/**
 * Engine types. Every monetary value is a decimal STRING at full precision.
 * Nothing in this module rounds for display; see ./rounding.ts.
 */

export const CALC_VERSION = "v0.3";

export type Currency = "USD" | "MXN" | "INR";
export type Case = "low" | "typical" | "high";
export const CASES: readonly Case[] = ["low", "typical", "high"] as const;

/** Low / typical / high describe the RESULT. So `low` carries the largest cost. */
export interface Triple {
  low: string;
  typical: string;
  high: string;
}

/** Provenance of a figure. The UI must render each one distinctly. */
export type SourceClass =
  | "live"
  | "published"
  | "provider_quote"
  | "manual"
  | "modelled"
  | "supplier_reported"
  | "payer_reported"
  | "bank_confirmed"
  | "unavailable";

export interface RateSnapshot {
  id: string;
  base: Currency; // e.g. USD
  quote: Currency; // e.g. MXN  -> rate = quote units per 1 base unit
  rate: string;
  source: string; // human label, e.g. "Sample rate"
  classification: SourceClass;
  retrievedAt: string; // ISO
  isDemo: boolean;
  /**
   * Provenance for rates taken from an FX benchmark (optional; manual and demo rates omit it).
   * Never read by the engine: it is frozen with every estimate so the calculation stays traceable.
   */
  observedAt?: string; // when the SOURCE observed the rate (may be well before retrievedAt)
  benchmarkId?: string;
  benchmarkProvider?: string;
  benchmarkPolicy?: string;
}

export type PayoutMethod = "spei_mxn" | "usd_account" | "imps_inr";
export type RouteMethod = "local_payout" | "bank_fx_wire" | "usd_wire";
export type ChargeCode = "SHA" | "OUR" | "BEN";
export type Eligibility = "approved" | "unverified" | "disabled";

export interface FeeRule {
  id: string;
  routeId: string; // groups options of one route (e.g. charge codes)
  providerId: string;
  providerName: string;
  routeName: string;
  optionLabel: string | null; // e.g. "SHA"
  method: RouteMethod;
  sourceCurrency: Currency;
  destCurrency: Currency; // what the beneficiary receives
  invoiceCurrencies: Currency[]; // invoice currencies this route can settle
  payoutMethod: PayoutMethod;
  chargeCode: ChargeCode | null;
  /** Paid by the sender ON TOP of the principal, in source currency. Never deducted from the receipt. null = unknown. */
  senderFee: string | null;
  /** FX markup in PERCENT applied at conversion. null = unknown. */
  markupPct: Triple | null;
  /** Intermediary deductions taken from the principal, in source currency. null = unknown. */
  deduction: Triple | null;
  /** Fixed receiving fee in destination currency, taken from the receipt. null = unknown. */
  receivingFee: string | null;
  feePayer: "sender" | "shared" | "beneficiary";
  minAmount: string | null; // principal bounds, source currency
  maxAmount: string | null;
  speedDays: { min: number; max: number };
  speedLabel: string;
  eligibility: Eligibility;
  eligibilityNote: string;
  source: string; // e.g. "Fee schedule v4"
  classification: SourceClass;
  lastVerifiedAt: string; // ISO
  effectiveFrom: string; // ISO date
}

export type Stage = "sending" | "intermediary" | "conversion" | "receiving" | "result";
export type Payer = "you" | "from_principal" | "from_receipt" | "on_top" | "none";

export interface BreakdownLine {
  key: "principal" | "deduction" | "conversion" | "markup" | "receiving_fee" | "result" | "sender_fee";
  label: string;
  stage: Stage;
  payer: Payer;
  /** Signed amount: deductions are negative. Full precision. */
  amount: string;
  currency: Currency;
  /** Running balance after this line, where meaningful. */
  balance: string | null;
  balanceCurrency: Currency | null;
  source: string;
  classification: SourceClass;
  timestamp: string | null;
  known: boolean;
  note?: string;
}

export interface CaseResult {
  receipt: string;
  markupPct: string;
  deduction: string;
  receivingFee: string;
  lines: BreakdownLine[];
}

export type Cover = "even_low" | "typical" | "may_short" | "short_all" | "unknown";

export interface OptionEstimate {
  optionId: string;
  ruleId: string;
  routeId: string;
  providerId: string;
  label: string; // "Fintech B, peso payout"
  optionLabel: string | null;
  method: RouteMethod;
  speedLabel: string;
  isTopUp: boolean;
  sendAmount: string; // A
  sourceCurrency: Currency;
  destCurrency: Currency;
  senderFee: string | null;
  youPay: string | null; // A + sender fee, null if sender fee unknown
  /** null when a cost component is unknown (rough estimate): the floor cannot be bounded. */
  low: string | null;
  typical: string;
  high: string;
  rough: boolean;
  missing: string[];
  cases: Record<Case, CaseResult>;
  /** Sender's all-in cost against the mid-market value of the typical receipt, in source currency. */
  allInCost: { amount: string; pct: string } | null;
  /** Principal needed so that the case receipt covers the invoice (rounded UP to the cent). */
  coverSend: { typical: string | null; low: string | null };
  covers: Cover;
  shortfallTypical: string; // invoice - typical (may be negative = surplus)
}

export interface ExcludedRoute {
  ruleId: string;
  label: string;
  reason: string;
  code: ExclusionCode;
}

export type ExclusionCode =
  | "disabled"
  | "eligibility_unverified"
  | "invoice_currency"
  | "payout_method"
  | "amount_range"
  | "arrives_late"
  | "deduction_exceeds"
  | "corridor";

export type Verdict =
  | { kind: "favoured"; optionId: string; marginOverNext: string; nextOptionId: string }
  | { kind: "too_close"; optionIds: string[] }
  | { kind: "unrankable"; reason: string; roughOptionIds: string[] }
  | { kind: "single"; optionId: string }
  | { kind: "none_eligible"; reason: string }
  | { kind: "cover"; plannedOptionId: string; covers: Cover; topUpOptionId: string | null };

export interface ComparisonInput {
  invoiceAmount: string;
  invoiceCurrency: Currency;
  sourceCurrency: Currency;
  destCountry: "MX" | "IN";
  sendAmount: string;
  payoutMethod: PayoutMethod;
  providers: string[];
  payBy: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD, injected for determinism
  rate: RateSnapshot | null;
  rules: FeeRule[];
  /** For USD-invoice comparisons: the charge code used for the planned option and the top-up. */
  defaultChargeCode?: ChargeCode;
}

export interface ComparisonResult {
  mode: "compare" | "cover";
  options: OptionEstimate[];
  excluded: ExcludedRoute[];
  verdict: Verdict;
  /** Invoice expressed in destination currency at mid-market, before any cost (for the composer sentence). */
  grossAtMid: string | null;
}
