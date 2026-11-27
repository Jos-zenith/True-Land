import { Dec, dec, str, ceilTo, ZERO, ONE, HUNDRED, EngineError } from "./decimal";
import type {
  BreakdownLine,
  Case,
  CaseResult,
  Cover,
  Currency,
  FeeRule,
  OptionEstimate,
  RateSnapshot,
} from "./types";
import { CASES } from "./types";

/**
 * Landed amount for one case.
 *
 *   R = (A − D) × m × (1 − s) − F_r
 *
 * A   principal sent (source currency)
 * D   intermediary deductions taken from the principal (source currency)
 * m   mid-market rate, destination units per source unit (1 when no conversion)
 * s   FX markup as a fraction (0 when no conversion)
 * F_r receiving fee (destination currency)
 *
 * Sender fees are paid ON TOP and are part of the sender's cost, never subtracted from R.
 */
export function landedAmount(params: { A: Dec; D: Dec; m: Dec; s: Dec; Fr: Dec }): Dec {
  const { A, D, m, s, Fr } = params;
  if (A.lte(ZERO)) throw new EngineError("INVALID_INPUT", "Principal must be greater than zero.");
  if (D.lt(ZERO) || Fr.lt(ZERO) || s.lt(ZERO)) throw new EngineError("INVALID_INPUT", "Costs cannot be negative.");
  if (s.gte(ONE)) throw new EngineError("INVALID_INPUT", "Markup must be below 100%.");
  if (m.lte(ZERO)) throw new EngineError("INVALID_INPUT", "Rate must be greater than zero.");
  if (D.gte(A)) throw new EngineError("DEDUCTION_EXCEEDS_PRINCIPAL", "Deductions would consume the whole principal.");
  const R = A.minus(D).times(m).times(ONE.minus(s)).minus(Fr);
  if (R.lt(ZERO)) throw new EngineError("NEGATIVE_RECEIPT", "Costs exceed the amount that would arrive.");
  return R;
}

/** Principal needed so that the receipt equals `target`, rounded UP to the cent so the target is always met. */
export function principalToCover(params: { target: Dec; D: Dec; m: Dec; s: Dec; Fr: Dec }): Dec {
  const { target, D, m, s, Fr } = params;
  const raw = target.plus(Fr).div(m.times(ONE.minus(s))).plus(D);
  return ceilTo(raw, 2);
}

export function needsConversion(rule: FeeRule): boolean {
  return rule.sourceCurrency !== rule.destCurrency;
}

export function rateFor(rule: FeeRule, rate: RateSnapshot | null): Dec {
  if (!needsConversion(rule)) return ONE;
  if (!rate) throw new EngineError("RATE_MISSING", "No exchange rate is available for this corridor.");
  if (rate.base !== rule.sourceCurrency || rate.quote !== rule.destCurrency) {
    throw new EngineError(
      "UNSUPPORTED_CURRENCY_PAIR",
      `Rate ${rate.base}/${rate.quote} cannot price ${rule.sourceCurrency}→${rule.destCurrency}.`,
    );
  }
  return dec(rate.rate);
}

interface Components {
  D: Dec;
  s: Dec; // fraction
  markupPct: Dec;
  Fr: Dec;
  known: { deduction: boolean; markup: boolean; receivingFee: boolean };
}

function components(rule: FeeRule, c: Case): Components {
  const conv = needsConversion(rule);
  const deductionKnown = rule.deduction !== null;
  const markupKnown = !conv || rule.markupPct !== null;
  const feeKnown = rule.receivingFee !== null;
  const D = deductionKnown ? dec(rule.deduction![c]) : ZERO;
  const markupPct = conv && rule.markupPct ? dec(rule.markupPct[c]) : ZERO;
  const Fr = feeKnown ? dec(rule.receivingFee!) : ZERO;
  return {
    D,
    s: markupPct.div(HUNDRED),
    markupPct,
    Fr,
    known: { deduction: deductionKnown, markup: markupKnown, receivingFee: feeKnown },
  };
}

function caseResult(rule: FeeRule, rate: RateSnapshot | null, A: Dec, c: Case): CaseResult {
  const m = rateFor(rule, rate);
  const k = components(rule, c);
  const R = landedAmount({ A, D: k.D, m, s: k.s, Fr: k.Fr });
  const src = rule.sourceCurrency;
  const dst = rule.destCurrency;
  const conv = needsConversion(rule);
  const lines: BreakdownLine[] = [];
  const schedule = { source: rule.source, classification: rule.classification, timestamp: rule.lastVerifiedAt };

  lines.push({
    key: "principal",
    label: `Principal sent`,
    stage: "sending",
    payer: "you",
    amount: str(A),
    currency: src,
    balance: str(A),
    balanceCurrency: src,
    source: "Check input",
    classification: "manual",
    timestamp: null,
    known: true,
  });

  const afterD = A.minus(k.D);
  lines.push({
    key: "deduction",
    label: "Intermediary deductions",
    stage: "intermediary",
    payer: "from_principal",
    amount: str(k.D.neg()),
    currency: src,
    balance: str(afterD),
    balanceCurrency: src,
    ...schedule,
    classification: k.known.deduction ? schedule.classification : "unavailable",
    known: k.known.deduction,
    note: k.known.deduction ? undefined : "Not known. Treated as 0, so the supplier may receive less.",
  });

  const converted = afterD.times(m);
  if (conv && rate) {
    lines.push({
      key: "conversion",
      label: `Converted at ${rate.rate} (mid-market)`,
      stage: "conversion",
      payer: "none",
      amount: str(converted),
      currency: dst,
      balance: str(converted),
      balanceCurrency: dst,
      source: rate.source,
      classification: rate.classification,
      timestamp: rate.retrievedAt,
      known: true,
    });
    const markupAmt = converted.times(k.s);
    lines.push({
      key: "markup",
      label: `FX markup ${k.markupPct.toFixed()}%`,
      stage: "conversion",
      payer: "from_principal",
      amount: str(markupAmt.neg()),
      currency: dst,
      balance: str(converted.minus(markupAmt)),
      balanceCurrency: dst,
      ...schedule,
      classification: k.known.markup ? schedule.classification : "unavailable",
      known: k.known.markup,
      note: k.known.markup ? undefined : "Not known. Treated as 0, so the supplier may receive less.",
    });
  }

  lines.push({
    key: "receiving_fee",
    label: "Receiving fee",
    stage: "receiving",
    payer: "from_receipt",
    amount: str(k.Fr.neg()),
    currency: dst,
    balance: str(R),
    balanceCurrency: dst,
    ...schedule,
    classification: k.known.receivingFee ? schedule.classification : "unavailable",
    known: k.known.receivingFee,
    note: k.known.receivingFee ? undefined : "Not known. Treated as 0, so the supplier may receive less.",
  });

  lines.push({
    key: "result",
    label: "Supplier receives",
    stage: "result",
    payer: "none",
    amount: str(R),
    currency: dst,
    balance: null,
    balanceCurrency: null,
    source: "Calculated",
    classification: "modelled",
    timestamp: null,
    known: k.known.deduction && k.known.markup && k.known.receivingFee,
  });

  lines.push({
    key: "sender_fee",
    label: "Sending fee, paid on top",
    stage: "sending",
    payer: "on_top",
    amount: rule.senderFee === null ? "0" : str(dec(rule.senderFee)),
    currency: src,
    balance: null,
    balanceCurrency: null,
    ...schedule,
    classification: rule.senderFee === null ? "unavailable" : schedule.classification,
    known: rule.senderFee !== null,
    note: "Added to your cost. Never subtracted from what the supplier receives.",
  });

  return {
    receipt: str(R),
    markupPct: k.markupPct.toFixed(),
    deduction: str(k.D),
    receivingFee: str(k.Fr),
    lines,
  };
}

export function missingComponents(rule: FeeRule): string[] {
  const out: string[] = [];
  if (rule.deduction === null) out.push("intermediary deductions");
  if (needsConversion(rule) && rule.markupPct === null) out.push("FX markup");
  if (rule.receivingFee === null) out.push("receiving fee");
  return out;
}

export function coverStatus(params: { invoice: Dec; low: Dec | null; typical: Dec; high: Dec }): Cover {
  const { invoice, low, typical, high } = params;
  if (low === null) {
    // Unknown costs can only lower the receipt, so we can still say "short" when even the upper figure misses.
    return high.lt(invoice) ? "short_all" : "unknown";
  }
  if (low.gte(invoice)) return "even_low";
  if (typical.gte(invoice)) return "typical";
  if (high.gte(invoice)) return "may_short";
  return "short_all";
}

/**
 * Estimate one route option. Pure: same inputs always give the same output.
 * `invoice` is in the option's destination currency when the invoice can be compared directly.
 */
export function estimateOption(params: {
  rule: FeeRule;
  rate: RateSnapshot | null;
  sendAmount: string;
  invoiceAmount: string;
  invoiceCurrency: Currency;
  isTopUp?: boolean;
  optionId?: string;
}): OptionEstimate {
  const { rule, rate } = params;
  const A = dec(params.sendAmount);
  const invoice = dec(params.invoiceAmount);
  if (params.invoiceCurrency !== rule.destCurrency) {
    throw new EngineError(
      "UNSUPPORTED_CURRENCY_PAIR",
      `Invoice in ${params.invoiceCurrency} cannot be compared with a ${rule.destCurrency} receipt.`,
    );
  }
  const cases = {} as Record<Case, CaseResult>;
  for (const c of CASES) cases[c] = caseResult(rule, rate, A, c);

  const missing = missingComponents(rule);
  const rough = missing.length > 0;
  const typical = dec(cases.typical.receipt);
  const high = dec(cases.high.receipt);
  const low = rough ? null : dec(cases.low.receipt);

  const m = rateFor(rule, rate);
  const youPay = rule.senderFee === null ? null : A.plus(dec(rule.senderFee));
  let allInCost: OptionEstimate["allInCost"] = null;
  if (youPay && !rough) {
    const midValueOfReceipt = typical.div(m);
    const amount = youPay.minus(midValueOfReceipt);
    allInCost = { amount: str(amount), pct: str(amount.div(youPay).times(HUNDRED)) };
  }

  const coverFor = (c: Case): string | null => {
    if (rough) return null;
    const k = components(rule, c);
    return str(principalToCover({ target: invoice, D: k.D, m, s: k.s, Fr: k.Fr }));
  };

  return {
    optionId: params.optionId ?? rule.id,
    ruleId: rule.id,
    routeId: rule.routeId,
    providerId: rule.providerId,
    label: rule.routeName,
    optionLabel: rule.optionLabel,
    method: rule.method,
    speedLabel: rule.speedLabel,
    isTopUp: params.isTopUp ?? false,
    sendAmount: str(A),
    sourceCurrency: rule.sourceCurrency,
    destCurrency: rule.destCurrency,
    senderFee: rule.senderFee,
    youPay: youPay ? str(youPay) : null,
    low: low ? str(low) : null,
    typical: str(typical),
    high: str(high),
    rough,
    missing,
    cases,
    allInCost,
    coverSend: { typical: coverFor("typical"), low: coverFor("low") },
    covers: coverStatus({ invoice, low, typical, high }),
    shortfallTypical: str(invoice.minus(typical)),
  };
}
