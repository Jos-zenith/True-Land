import type { FeeRule, RateSnapshot } from "@/engine";

/**
 * ILLUSTRATIVE DEMO ASSUMPTIONS.
 * Provider names are generic placeholders. No figure here comes from a real bank or provider,
 * and no provider API is integrated. Every rule is classified "modelled".
 */

export const PROVIDERS = [
  { id: "bank_a", name: "Bank A", kind: "Bank" },
  { id: "bank_b", name: "Bank B", kind: "Bank" },
  { id: "fintech_a", name: "Fintech A", kind: "Fintech" },
  { id: "fintech_b", name: "Fintech B", kind: "Fintech" },
  { id: "fintech_x", name: "Fintech X", kind: "Fintech" },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

type RuleBase = Omit<FeeRule, "source" | "lastVerifiedAt" | "effectiveFrom">;

const MXN_COMMON = {
  sourceCurrency: "USD",
  destCurrency: "MXN",
  invoiceCurrencies: ["MXN"],
  payoutMethod: "spei_mxn",
  chargeCode: null,
  optionLabel: null,
  classification: "modelled",
} as const;

const USD_WIRE_COMMON = {
  routeId: "bank_a_usd",
  providerId: "bank_a",
  providerName: "Bank A",
  routeName: "Bank A USD wire",
  method: "usd_wire",
  sourceCurrency: "USD",
  destCurrency: "USD",
  invoiceCurrencies: ["USD"],
  payoutMethod: "usd_account",
  markupPct: { low: "0", typical: "0", high: "0" },
  receivingFee: "0",
  minAmount: "100",
  maxAmount: "1000000",
  speedDays: { min: 1, max: 2 },
  speedLabel: "1 to 2 days",
  eligibility: "approved",
  eligibilityNote: "Approved by counsel (sample)",
  classification: "modelled",
} as const;

/** Fee schedule v4 rule bodies. v3 differs only where noted in `scheduleV3`. */
export const RULES_V4: RuleBase[] = [
  {
    ...MXN_COMMON,
    id: "fintech_b_mxn",
    routeId: "fintech_b_mxn",
    providerId: "fintech_b",
    providerName: "Fintech B",
    routeName: "Fintech B, peso payout",
    method: "local_payout",
    senderFee: "12",
    markupPct: { low: "0.8", typical: "0.7", high: "0.6" },
    deduction: { low: "0", typical: "0", high: "0" },
    receivingFee: "0",
    feePayer: "sender",
    minAmount: "1",
    maxAmount: "250000",
    speedDays: { min: 0, max: 0 },
    speedLabel: "same day",
    eligibility: "approved",
    eligibilityNote: "Supplier accepts pesos; account held; approved by counsel (sample)",
  },
  {
    ...MXN_COMMON,
    id: "bank_a_mxn",
    routeId: "bank_a_mxn",
    providerId: "bank_a",
    providerName: "Bank A",
    routeName: "Bank A wire, shared charges",
    method: "bank_fx_wire",
    senderFee: "30",
    markupPct: { low: "3.5", typical: "3.0", high: "2.5" },
    deduction: { low: "40", typical: "25", high: "10" },
    receivingFee: "0",
    feePayer: "shared",
    minAmount: "100",
    maxAmount: "1000000",
    speedDays: { min: 1, max: 2 },
    speedLabel: "1 to 2 days",
    eligibility: "approved",
    eligibilityNote: "Approved by counsel (sample)",
  },
  {
    ...MXN_COMMON,
    id: "fintech_a_mxn",
    routeId: "fintech_a_mxn",
    providerId: "fintech_a",
    providerName: "Fintech A",
    routeName: "Fintech A, peso payout",
    method: "local_payout",
    senderFee: "15",
    markupPct: { low: "0.75", typical: "0.62", high: "0.5" },
    deduction: { low: "0", typical: "0", high: "0" },
    receivingFee: "0",
    feePayer: "sender",
    minAmount: "1",
    maxAmount: "100000",
    speedDays: { min: 0, max: 1 },
    speedLabel: "same or next day",
    eligibility: "approved",
    eligibilityNote: "Approved by counsel (sample)",
  },
  {
    ...MXN_COMMON,
    id: "bank_b_mxn",
    routeId: "bank_b_mxn",
    providerId: "bank_b",
    providerName: "Bank B",
    routeName: "Bank B wire to pesos",
    method: "bank_fx_wire",
    senderFee: "25",
    markupPct: { low: "1.4", typical: "1.0", high: "0.6" },
    deduction: { low: "30", typical: "20", high: "10" },
    receivingFee: null, // not published: estimates for this route are rough
    feePayer: "shared",
    minAmount: "100",
    maxAmount: "1000000",
    speedDays: { min: 1, max: 2 },
    speedLabel: "1 to 2 days",
    eligibility: "approved",
    eligibilityNote: "Approved by counsel (sample); receiving bank fee not published",
  },
  {
    ...MXN_COMMON,
    id: "fintech_x_mxn",
    routeId: "fintech_x_mxn",
    providerId: "fintech_x",
    providerName: "Fintech X",
    routeName: "Fintech X, stablecoin-settled payout",
    method: "local_payout",
    senderFee: "5",
    markupPct: { low: "0.5", typical: "0.4", high: "0.3" },
    deduction: { low: "0", typical: "0", high: "0" },
    receivingFee: "0",
    feePayer: "sender",
    minAmount: "1",
    maxAmount: "100000",
    speedDays: { min: 0, max: 0 },
    speedLabel: "same day",
    eligibility: "unverified",
    eligibilityNote: "stablecoin settlement has not passed legal and operational review",
  },
  {
    ...USD_WIRE_COMMON,
    id: "bank_a_usd_sha",
    optionLabel: "SHA",
    chargeCode: "SHA",
    senderFee: "30",
    deduction: { low: "40", typical: "25", high: "10" },
    feePayer: "shared",
  },
  {
    ...USD_WIRE_COMMON,
    id: "bank_a_usd_our",
    optionLabel: "OUR",
    chargeCode: "OUR",
    senderFee: "55",
    deduction: { low: "15", typical: "0", high: "0" },
    feePayer: "sender",
  },
  {
    ...USD_WIRE_COMMON,
    id: "bank_a_usd_ben",
    optionLabel: "BEN",
    chargeCode: "BEN",
    senderFee: "0",
    deduction: { low: "70", typical: "55", high: "40" },
    feePayer: "beneficiary",
  },
] as unknown as RuleBase[];

export function withProvenance(rules: RuleBase[], version: number, verifiedAt: string): FeeRule[] {
  return rules.map((r) => ({
    ...r,
    source: `Fee schedule v${version}`,
    lastVerifiedAt: verifiedAt,
    effectiveFrom: verifiedAt.slice(0, 10),
  }));
}

/** v3: Fintech B markup band was wider (0.9 / 0.7 / 0.5). v4 narrowed it. */
export function rulesV3(): RuleBase[] {
  return RULES_V4.map((r) =>
    r.id === "fintech_b_mxn" ? { ...r, markupPct: { low: "0.9", typical: "0.7", high: "0.5" } } : r,
  );
}

export function sampleRate(id: string, rate: string, retrievedAt: string): RateSnapshot {
  return {
    id,
    base: "USD",
    quote: "MXN",
    rate,
    source: "Sample rate",
    classification: "manual",
    retrievedAt,
    isDemo: true,
  };
}

/** Control corridor: used only as an engine test fixture, never shown in the product. */
export const INDIA_FIXTURE_RULE: FeeRule = {
  id: "fixture_inr",
  routeId: "fixture_inr",
  providerId: "fixture",
  providerName: "Fixture",
  routeName: "Control corridor fixture",
  optionLabel: null,
  method: "local_payout",
  sourceCurrency: "USD",
  destCurrency: "INR",
  invoiceCurrencies: ["INR"],
  payoutMethod: "imps_inr",
  chargeCode: null,
  senderFee: "10",
  markupPct: { low: "1.0", typical: "0.8", high: "0.6" },
  deduction: { low: "0", typical: "0", high: "0" },
  receivingFee: "0",
  feePayer: "sender",
  minAmount: "1",
  maxAmount: "100000",
  speedDays: { min: 0, max: 1 },
  speedLabel: "same or next day",
  eligibility: "approved",
  eligibilityNote: "Test fixture",
  source: "Test fixture",
  classification: "modelled",
  lastVerifiedAt: "2026-11-25T15:00:00.000Z",
  effectiveFrom: "2026-11-25",
};
