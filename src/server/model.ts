import type { ChargeCode, ComparisonResult, Currency, FeeRule, PayoutMethod, RateSnapshot } from "@/engine";

export type CheckStatus = "draft" | "choose_route" | "awaiting_receipt" | "reconciled" | "no_reply" | "refused";
/**
 * "verified" is set by the system only, after a LIVE receipt verification passes for that exact amount.
 * "demo_verified" is the same check run against a labelled DEMO fixture: it proves nothing about a real
 * payment and is always shown as "Verified (demo)".
 */
export type EvidenceLevel = "modelled" | "reported" | "tax_record" | "demo_verified" | "verified";
export type Access = "admin" | "member" | "viewer";
export type ReportedBy = "supplier" | "payer" | "provider_statement";
export type PlanChange = "route" | "amount" | "timing" | "nothing";

export interface User {
  id: string;
  name: string;
  /** Job title shown in the UI, e.g. "AP clerk". Not used for authorization. */
  role: string;
  initials: string;
  /** Derived from `access`. Kept for existing view code. */
  isAdmin: boolean;
  access: Access;
}

export interface CheckInputs {
  invoiceAmount: string;
  invoiceCurrency: Currency;
  sourceCountry: "US";
  destCountry: "MX";
  sourceCurrency: "USD";
  sendAmount: string;
  payBy: string; // YYYY-MM-DD
  payoutMethod: PayoutMethod;
  providers: string[];
  invoiceRef: string | null;
  chargeCode: ChargeCode;
}

/** Immutable once written. A recalculation appends a new snapshot. */
export interface EstimateSnapshot {
  id: string;
  computedAt: string;
  calcVersion: string;
  scheduleVersion: number;
  rate: RateSnapshot | null;
  rules: FeeRule[]; // copies of the rules used, frozen
  inputs: CheckInputs; // copy of the inputs used
  result: ComparisonResult;
}

export interface Quote {
  id: string;
  at: string;
  by: string;
  ruleId: string;
  kind: "amount" | "rate";
  value: string;
  /** Resolved receipt implied by the quote, in destination currency. */
  quotedReceipt: string;
  impliedMarkupPct: string | null;
  estimateId: string;
  validUntil: string | null;
}

export interface Choice {
  id: string;
  at: string;
  by: string;
  optionId: string;
  estimateId: string;
  paidOn: string; // planned payment date YYYY-MM-DD
  replyDue: string; // YYYY-MM-DD
  recordedStale: boolean;
  rateAgeHours: number;
  /** Frozen copy of what was chosen, so later edits can never change it. */
  snapshot: {
    label: string;
    optionLabel: string | null;
    isTopUp: boolean;
    sendAmount: string;
    youPay: string | null;
    low: string | null;
    typical: string;
    high: string;
    currency: Currency;
    quote: string | null;
  };
}

export interface Outcome {
  id: string;
  at: string;
  by: string;
  result: "received" | "no_reply" | "refused";
  amount: string | null;
  currency: Currency | null;
  date: string; // date of receipt or reply
  reportedBy: ReportedBy | null;
  reference: string | null;
  level: EvidenceLevel;
  evidenceId: string | null;
  correctionOf: string | null;
}

export interface EvidenceRecord {
  id: string;
  at: string;
  by: string;
  kind: "cep";
  /** "demo": a labelled fixture, nothing real was checked. "live": a configured verification provider answered. */
  mode: "demo" | "live";
  /** Verifier identity, e.g. "demo-fixture" or "remote:<host>". */
  provider: string;
  /** Demo fixture used, when mode is "demo". */
  demo: "match" | "mismatch" | "unreadable" | null;
  /** Provider's reference for a live lookup. */
  providerRef: string | null;
  fileName: string;
  /** Entered by the user. The beneficiary account is NEVER stored. */
  entered: { amount: string; date: string; sendingBank: string; receivingBank: string; trackingKey: string | null };
  file: { amount: string; date: string; sendingBank: string; receivingBank: string } | null;
  result: "verified" | "mismatch" | "unreadable" | "invalid_account" | "not_found";
  detail: string;
}

export interface CheckEvent {
  id: string;
  at: string;
  actor: string; // user id or "system"
  type:
    | "created"
    | "draft_saved"
    | "estimate_computed"
    | "calc_failed"
    | "inputs_modified"
    | "quote_added"
    | "route_selected"
    | "outcome_recorded"
    | "outcome_corrected"
    | "evidence_checked"
    | "plan_change"
    | "note"
    | "archived"
    | "restored"
    | "duplicated"
    | "export";
  message: string;
}

export interface Check {
  id: string; // CHK-014
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  supplierHash: string; // 6 hex chars; nickname stays on the device
  status: CheckStatus;
  archived: boolean;
  inputs: CheckInputs;
  estimates: EstimateSnapshot[];
  calcError: { at: string; code: string; message: string } | null;
  quotes: Quote[];
  choice: Choice | null;
  outcomes: Outcome[];
  evidence: EvidenceRecord[];
  planChanges: { at: string; by: string; answer: PlanChange }[];
  events: CheckEvent[];
  isDemo: boolean;
}

export interface FeeVersion {
  version: number;
  publishedAt: string;
  publishedBy: string;
  note: string;
  rules: FeeRule[];
}

export interface ConfigEvent {
  id: string;
  at: string;
  actor: string;
  type: "schedule_published" | "rate_entered" | "demo_reset";
  message: string;
}

export interface Database {
  schema: 1;
  seededAt: string;
  workspace: { id: string; name: string; isDemo: boolean; corridor: "US→MX" };
  currentUserId: string;
  users: User[];
  checks: Check[];
  rates: RateSnapshot[];
  feeVersions: FeeVersion[];
  feeDraft: { basedOn: number; rules: FeeRule[]; updatedAt: string } | null;
  configEvents: ConfigEvent[];
  counters: { check: number; id: number };
}
