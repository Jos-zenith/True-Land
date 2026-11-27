import type { SourceClass, Cover } from "@/engine/types";
import type { CheckStatus, EvidenceLevel, ReportedBy, PlanChange } from "@/server/model";

export const STATUS_LABEL: Record<CheckStatus, string> = {
  draft: "Draft",
  choose_route: "Choose route",
  awaiting_receipt: "Awaiting receipt",
  reconciled: "Reconciled",
  no_reply: "No reply",
  refused: "Refused",
};

export const STATUS_ORDER: CheckStatus[] = ["draft", "choose_route", "awaiting_receipt", "no_reply", "refused", "reconciled"];

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  modelled: "Modelled",
  reported: "Reported",
  tax_record: "Tax record",
  demo_verified: "Verified (demo)",
  verified: "Verified",
};

export const EVIDENCE_HELP: Record<EvidenceLevel, string> = {
  modelled: "Estimate only. Nothing observed yet.",
  reported: "Stated by the supplier or by you. Not independently checked.",
  tax_record: "Payment complement. May show the full rather than the net amount.",
  demo_verified: "A DEMO receipt file matched. This is a demonstration only: no real bank record or CEP was checked.",
  verified: "An official SPEI receipt (CEP) was checked by a live verification provider and matched. Set by the system only.",
};

export const SOURCE_LABEL: Record<SourceClass, string> = {
  live: "Live source",
  published: "Published schedule",
  provider_quote: "Provider quote",
  manual: "Manually entered",
  modelled: "Modelled",
  supplier_reported: "Supplier-reported",
  payer_reported: "Payer-reported",
  bank_confirmed: "Bank/provider-confirmed",
  unavailable: "Unavailable",
};

export const REPORTED_BY_LABEL: Record<ReportedBy, string> = {
  supplier: "Supplier",
  payer: "Us (payer)",
  provider_statement: "Bank or provider statement",
};

export const PLAN_CHANGE_LABEL: Record<PlanChange, string> = {
  route: "Route",
  amount: "Amount",
  timing: "Timing",
  nothing: "Nothing",
};

export const COVER_LABEL: Record<Cover, string> = {
  even_low: "Even the low estimate covers the invoice",
  typical: "Covers in the typical case; may arrive short",
  may_short: "May arrive short",
  short_all: "Short in every case shown",
  unknown: "Cover unknown: a cost is missing",
};

export const PAYOUT_LABEL = {
  spei_mxn: "Pesos by SPEI",
  usd_account: "US dollars to a USD account",
  imps_inr: "Rupees by IMPS",
} as const;
