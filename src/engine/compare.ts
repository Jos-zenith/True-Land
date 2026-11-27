import { dec, str, EngineError } from "./decimal";
import { estimateOption, landedAmount, rateFor } from "./estimate";
import type {
  ComparisonInput,
  ComparisonResult,
  Currency,
  ExcludedRoute,
  FeeRule,
  OptionEstimate,
  RateSnapshot,
  Verdict,
} from "./types";

const CURRENCY_NAME: Record<Currency, string> = { USD: "dollars", MXN: "pesos", INR: "rupees" };
const PAYOUT_NAME = { spei_mxn: "pesos by SPEI", usd_account: "US dollars to a USD account", imps_inr: "rupees by IMPS" };

/** Weekdays strictly after `from` up to and including `to` (both YYYY-MM-DD). Negative when `to` is before `from`. */
export function businessDaysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    throw new EngineError("INVALID_INPUT", "Dates must be YYYY-MM-DD.");
  }
  if (b < a) return -1;
  let days = 0;
  const d = new Date(a);
  while (d < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  return days;
}

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Why a rule cannot be used for this check, or null when it is eligible. Order of checks is deliberate. */
export function exclusionFor(rule: FeeRule, input: ComparisonInput): ExcludedRoute | null {
  const ex = (code: ExcludedRoute["code"], reason: string): ExcludedRoute => ({
    ruleId: rule.id,
    label: rule.optionLabel ? `${rule.routeName} (${rule.optionLabel})` : rule.routeName,
    reason,
    code,
  });
  if (rule.eligibility === "disabled") return ex("disabled", "disabled in fee configuration");
  if (rule.eligibility === "unverified") return ex("eligibility_unverified", `eligibility not verified: ${rule.eligibilityNote}`);
  if (rule.sourceCurrency !== input.sourceCurrency) return ex("corridor", `pays out from ${rule.sourceCurrency}`);
  if (!rule.invoiceCurrencies.includes(input.invoiceCurrency)) {
    return ex("invoice_currency", `this invoice is in ${CURRENCY_NAME[input.invoiceCurrency]}`);
  }
  if (rule.payoutMethod !== input.payoutMethod) {
    return ex("payout_method", `the supplier receives ${PAYOUT_NAME[input.payoutMethod]}`);
  }
  const A = dec(input.sendAmount);
  if (rule.minAmount !== null && A.lt(dec(rule.minAmount))) return ex("amount_range", `amount is below the route minimum of ${rule.minAmount}`);
  if (rule.maxAmount !== null && A.gt(dec(rule.maxAmount))) return ex("amount_range", `amount is above the route maximum of ${rule.maxAmount}`);
  const available = businessDaysBetween(input.today, input.payBy);
  if (available < rule.speedDays.max) return ex("arrives_late", `may not arrive by ${fmtDay(input.payBy)} (${rule.speedLabel})`);
  if (rule.deduction !== null && dec(rule.deduction.low).gte(A)) {
    return ex("deduction_exceeds", "deductions would consume the whole amount");
  }
  return null;
}

/**
 * Rank eligible options. A route is only called more favourable when its LOW estimate beats every other
 * option's HIGH estimate. Overlapping ranges are "too close to call". Rough estimates (unknown cost) are
 * upper bounds: they can only be ruled out when their HIGH is below the leader's LOW.
 */
export function rank(options: OptionEstimate[]): Verdict {
  if (options.length === 0) return { kind: "none_eligible", reason: "No route is eligible for these inputs." };
  if (options.length === 1) return { kind: "single", optionId: options[0].optionId };

  const firm = options.filter((o) => !o.rough);
  const rough = options.filter((o) => o.rough);
  if (firm.length === 0) {
    return {
      kind: "unrankable",
      reason: "Every eligible route is missing a cost component.",
      roughOptionIds: rough.map((o) => o.optionId),
    };
  }
  const sorted = [...firm].sort((a, b) => dec(b.typical).cmp(dec(a.typical)) || a.optionId.localeCompare(b.optionId));
  const leader = sorted[0];
  const leaderLow = dec(leader.low!);

  const roughThreat = rough.filter((o) => dec(o.high).gte(leaderLow));
  if (roughThreat.length > 0) {
    return {
      kind: "unrankable",
      reason: `${roughThreat.map((o) => o.label).join(", ")} is missing ${roughThreat[0].missing.join(" and ")}, and could be close to ${leader.label}.`,
      roughOptionIds: roughThreat.map((o) => o.optionId),
    };
  }

  const others = sorted.slice(1);
  if (others.length === 0) {
    // Only rough rivals remain, and each is ruled out (its upper figure is below the leader's floor).
    // The margin is measured against the rival's upper figure, so the true margin can only be larger.
    const bestRough = [...rough].sort((a, b) => dec(b.high).cmp(dec(a.high)))[0];
    if (!bestRough) return { kind: "single", optionId: leader.optionId };
    return {
      kind: "favoured",
      optionId: leader.optionId,
      nextOptionId: bestRough.optionId,
      marginOverNext: str(dec(leader.typical).minus(dec(bestRough.typical))),
    };
  }
  const overlapping = others.filter((o) => dec(o.high).gte(leaderLow));
  if (overlapping.length > 0) {
    return { kind: "too_close", optionIds: [leader.optionId, ...overlapping.map((o) => o.optionId)] };
  }
  const next = others[0];
  return {
    kind: "favoured",
    optionId: leader.optionId,
    nextOptionId: next.optionId,
    marginOverNext: str(dec(leader.typical).minus(dec(next.typical))),
  };
}

/** Full comparison for one check. Pure and deterministic. */
export function compareRoutes(input: ComparisonInput): ComparisonResult {
  if (dec(input.invoiceAmount).lte(0)) throw new EngineError("INVALID_INPUT", "Invoice amount must be greater than zero.");
  if (dec(input.sendAmount).lte(0)) throw new EngineError("INVALID_INPUT", "Amount to send must be greater than zero.");
  if (input.sourceCurrency !== "USD") throw new EngineError("UNSUPPORTED_CURRENCY_PAIR", "Only USD is supported as the paying currency.");
  const expectedDest: Currency = input.destCountry === "MX" ? "MXN" : "INR";
  if (input.invoiceCurrency !== "USD" && input.invoiceCurrency !== expectedDest) {
    throw new EngineError("UNSUPPORTED_CURRENCY_PAIR", `An invoice in ${input.invoiceCurrency} is not supported for this corridor.`);
  }

  const excluded: ExcludedRoute[] = [];
  const eligibleRules: FeeRule[] = [];
  for (const rule of input.rules) {
    if (!input.providers.includes(rule.providerId)) continue; // only routes the payer can actually use are discussed
    const ex = exclusionFor(rule, input);
    if (ex) excluded.push(ex);
    else eligibleRules.push(rule);
  }

  const options: OptionEstimate[] = [];
  for (const rule of eligibleRules) {
    try {
      options.push(
        estimateOption({
          rule,
          rate: input.rate,
          sendAmount: input.sendAmount,
          invoiceAmount: input.invoiceAmount,
          invoiceCurrency: input.invoiceCurrency,
        }),
      );
    } catch (e) {
      if (e instanceof EngineError && (e.code === "DEDUCTION_EXCEEDS_PRINCIPAL" || e.code === "NEGATIVE_RECEIPT")) {
        excluded.push({ ruleId: rule.id, label: rule.routeName, reason: "costs would exceed the amount sent", code: "deduction_exceeds" });
        continue;
      }
      throw e;
    }
  }

  let grossAtMid: string | null = null;
  if (input.rate && input.invoiceCurrency !== input.sourceCurrency) {
    grossAtMid = str(dec(input.sendAmount).times(dec(input.rate.rate)));
  }

  // USD invoice settled by USD wire: the question is "will the full amount arrive?"
  const mode: ComparisonResult["mode"] = input.invoiceCurrency === input.sourceCurrency ? "cover" : "compare";
  if (mode === "cover") {
    if (options.length === 0) {
      return { mode, options, excluded, verdict: { kind: "none_eligible", reason: noneReason(excluded) }, grossAtMid };
    }
    const code = input.defaultChargeCode ?? "SHA";
    const planned = options.find((o) => eligibleRules.find((r) => r.id === o.ruleId)?.chargeCode === code) ?? options[0];
    let topUpOptionId: string | null = null;
    if (planned.covers !== "even_low" && planned.coverSend.low) {
      const rule = eligibleRules.find((r) => r.id === planned.ruleId)!;
      const send = planned.coverSend.low;
      const topUp = estimateOption({
        rule,
        rate: input.rate,
        sendAmount: send,
        invoiceAmount: input.invoiceAmount,
        invoiceCurrency: input.invoiceCurrency,
        isTopUp: true,
        optionId: `${rule.id}@${send}`,
      });
      options.push(topUp);
      topUpOptionId = topUp.optionId;
    }
    return {
      mode,
      options,
      excluded,
      verdict: { kind: "cover", plannedOptionId: planned.optionId, covers: planned.covers, topUpOptionId },
      grossAtMid,
    };
  }

  const verdict: Verdict = options.length === 0 ? { kind: "none_eligible", reason: noneReason(excluded) } : rank(options);
  return { mode, options, excluded, verdict, grossAtMid };
}

function noneReason(excluded: ExcludedRoute[]): string {
  if (excluded.some((e) => e.code === "arrives_late")) return "Nothing arrives by the pay-by date.";
  if (excluded.length === 0) return "None of the selected providers offers a route for this payment.";
  return "Every route for the selected providers is excluded.";
}

/** What a provider quote implies, without replacing the modelled estimate. */
export function analyseQuote(params: {
  rule: FeeRule;
  rate: RateSnapshot | null;
  sendAmount: string;
  quote: { kind: "amount"; amount: string } | { kind: "rate"; rate: string };
  typical: string;
  low: string | null;
  high: string;
}): { quotedReceipt: string; impliedMarkupPct: string | null; diffFromTypical: string; insideRange: boolean | null } {
  const { rule } = params;
  const A = dec(params.sendAmount);
  const D = rule.deduction ? dec(rule.deduction.typical) : dec(0);
  const Fr = rule.receivingFee ? dec(rule.receivingFee) : dec(0);
  const m = rateFor(rule, params.rate);
  let quoted;
  if (params.quote.kind === "rate") {
    // The provider's quoted rate already contains its markup: apply it directly, no second markup.
    const q = dec(params.quote.rate);
    if (q.lte(0)) throw new EngineError("INVALID_INPUT", "Quoted rate must be greater than zero.");
    quoted = landedAmount({ A, D, m: q, s: dec(0), Fr });
  } else {
    quoted = dec(params.quote.amount);
    if (quoted.lte(0)) throw new EngineError("INVALID_INPUT", "Quoted amount must be greater than zero.");
  }
  let implied: string | null = null;
  if (rule.sourceCurrency !== rule.destCurrency) {
    // quoted = (A − D)·m·(1 − s) − Fr  →  s = 1 − (quoted + Fr) / ((A − D)·m)
    const s = dec(1).minus(quoted.plus(Fr).div(A.minus(D).times(m)));
    implied = str(s.times(100));
  }
  const typical = dec(params.typical);
  const insideRange = params.low === null ? null : quoted.gte(dec(params.low)) && quoted.lte(dec(params.high));
  return { quotedReceipt: str(quoted), impliedMarkupPct: implied, diffFromTypical: str(quoted.minus(typical)), insideRange };
}

