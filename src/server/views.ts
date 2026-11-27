import {
  analyseQuote,
  dec,
  rateFreshness,
  reconcile,
  scheduleFreshness,
  FRESHNESS,
  type FeeRule,
  type OptionEstimate,
  type SourceClass,
  type Verdict,
} from "@/engine";
import { fmtDay, fmtMoney, fmtNum, fmtPct, fmtStamp, fmtAgeHours, ymd } from "@/lib/format";
import { COVER_LABEL, EVIDENCE_LABEL, REPORTED_BY_LABEL, STATUS_LABEL } from "@/lib/labels";
import { currentRate, currentSchedule, latestEstimate, userName } from "./core";
import type { Check, Database, EstimateSnapshot, EvidenceLevel, Outcome } from "./model";
import { currentOutcome, latestQuoteFor } from "./services/checks";
import { PROVIDERS, providerName } from "./demo-data";

export type Tone = "short" | "warn" | "ok" | "neutral" | "error" | "info";
export interface Chip {
  tone: Tone;
  text: string;
  glyph: "dot" | "ring" | "square" | "none" | "half";
  title?: string;
}

export type ListGroup =
  | "draft"
  | "calc_failed"
  | "choose_route"
  | "awaiting_receipt"
  | "reply_overdue"
  | "no_reply"
  | "refused"
  | "reconciled";

export { GROUP_LABEL } from "./views-labels";

function routeLabel(o: { label: string; optionLabel: string | null; isTopUp?: boolean; sendAmount?: string }) {
  if (o.optionLabel) return `${o.label} ${o.optionLabel}${o.isTopUp && o.sendAmount ? `, send ${fmtNum(o.sendAmount, 2)}` : ""}`;
  return o.label;
}

/** The option the page leads with: the chosen option, else the favoured / planned / first eligible option. */
export function focusOption(est: EstimateSnapshot, check: Check): OptionEstimate | null {
  const opts = est.result.options;
  if (check.choice && check.choice.estimateId === est.id) return opts.find((o) => o.optionId === check.choice!.optionId) ?? null;
  const v = est.result.verdict;
  if (v.kind === "favoured" || v.kind === "single") return opts.find((o) => o.optionId === v.optionId) ?? null;
  if (v.kind === "cover") return opts.find((o) => o.optionId === v.plannedOptionId) ?? null;
  return opts[0] ?? null;
}

function evidenceLevel(check: Check): EvidenceLevel {
  const o = currentOutcome(check);
  if (!o || o.result !== "received") return "modelled";
  return o.level;
}

function isOverdue(check: Check, today: string) {
  return check.status === "awaiting_receipt" && !!check.choice && check.choice.replyDue < today;
}

function coverChip(o: OptionEstimate): Chip | null {
  if (o.covers === "even_low") return { tone: "ok", text: "Covers invoice", glyph: "dot" };
  if (o.covers === "typical") return { tone: "short", text: "May arrive short", glyph: "dot" };
  if (o.covers === "may_short") return { tone: "short", text: "May arrive short", glyph: "dot" };
  if (o.covers === "short_all") return { tone: "short", text: "Arrives short", glyph: "dot", title: COVER_LABEL.short_all };
  return { tone: "warn", text: "Cover unknown", glyph: "ring" };
}

export function listItem(db: Database, check: Check, nowMs: number) {
  const today = ymd(nowMs);
  const est = latestEstimate(check);
  const chosenEst = check.choice ? check.estimates.find((e) => e.id === check.choice!.estimateId) ?? est : est;
  const focus = chosenEst && !check.calcError ? focusOption(chosenEst, check) : null;
  const outcome = currentOutcome(check);
  const level = evidenceLevel(check);
  const overdue = isOverdue(check, today);

  let group: ListGroup = check.status as ListGroup;
  if (check.calcError && check.status === "choose_route") group = "calc_failed";
  if (overdue) group = "reply_overdue";

  const chips: Chip[] = [];
  const attention: string[] = [];
  const rate = est?.rate ? rateFreshness(est.rate.retrievedAt, nowMs) : null;

  if (check.status === "draft") {
    chips.push({ tone: "neutral", text: "Not compared yet", glyph: "ring" });
    attention.push("Draft not compared");
  }
  if (check.calcError) {
    chips.push({ tone: "error", text: "Calculation failed", glyph: "dot" });
    attention.push("Calculation failed");
  }
  if (check.status === "choose_route" && est && !check.calcError) {
    const v = est.result.verdict;
    if (v.kind === "none_eligible") {
      chips.push({ tone: "error", text: "No eligible route", glyph: "dot" });
      attention.push("No eligible route");
    } else if (v.kind === "too_close") chips.push({ tone: "neutral", text: "Too close to call", glyph: "ring" });
    else if (v.kind === "unrankable") {
      chips.push({ tone: "warn", text: "Rough estimate", glyph: "ring" });
      attention.push("Incomplete fee data");
    } else if (focus) {
      const c = coverChip(focus);
      if (c && c.tone !== "ok") chips.push(c);
    }
    if (rate?.stale) {
      chips.push({ tone: "warn", text: `Rate ${Math.floor(rate.hours)} h old`, glyph: "none" });
      attention.push("Stale rate");
    }
  }
  if (check.status === "awaiting_receipt" && check.choice) {
    if (overdue) {
      chips.push({ tone: "short", text: `Reply overdue since ${fmtDay(check.choice.replyDue)}`, glyph: "dot" });
      attention.push("Reply overdue");
    } else chips.push({ tone: "neutral", text: `Reply due ${fmtDay(check.choice.replyDue)}`, glyph: "none" });
  }

  let actual: { value: string; currency: string } | null = null;
  let ourError: string | null = null;
  let quoteError: string | null = null;
  let insideRange: boolean | null = null;
  if (outcome?.result === "received" && outcome.amount && check.choice) {
    const s = check.choice.snapshot;
    actual = { value: outcome.amount, currency: s.currency };
    const r = reconcile({ typical: s.typical, low: s.low, high: s.high, actual: outcome.amount, invoice: null, quote: s.quote });
    ourError = r.ourError;
    quoteError = r.quoteError;
    insideRange = r.insideRange;
    if (insideRange === false) {
      chips.push({ tone: "short", text: "Outside range", glyph: "dot" });
      attention.push("Actual outside range");
    }
  }
  chips.push({ tone: level === "verified" ? "ok" : "neutral", text: EVIDENCE_LABEL[level], glyph: level === "modelled" ? "ring" : level === "tax_record" ? "square" : "dot" });

  const snap = check.choice?.snapshot;
  const expected = snap
    ? { value: snap.typical, currency: snap.currency }
    : focus && est?.result.verdict.kind !== "too_close" && est?.result.verdict.kind !== "unrankable"
      ? { value: focus.typical, currency: focus.destCurrency }
      : null;
  const shortfall =
    check.status === "choose_route" && focus && expected && dec(focus.shortfallTypical).gt(0)
      ? { value: focus.shortfallTypical, currency: focus.destCurrency }
      : null;

  const i = check.inputs;
  return {
    id: check.id,
    supplierHash: check.supplierHash,
    status: check.status,
    statusLabel: group === "calc_failed" ? "Calculation failed" : group === "reply_overdue" ? "Awaiting receipt, overdue" : STATUS_LABEL[check.status],
    group,
    archived: check.archived,
    isDemo: check.isDemo,
    createdAt: check.createdAt,
    updatedAt: check.updatedAt,
    createdBy: { id: check.createdBy, name: userName(db, check.createdBy) },
    mine: check.createdBy === db.currentUserId,
    invoice: { amount: i.invoiceAmount, currency: i.invoiceCurrency },
    sendAmount: i.sendAmount,
    invoiceRef: i.invoiceRef,
    corridor: i.invoiceCurrency === "USD" ? "USD → USD" : "USD → MXN",
    payoutLabel: i.invoiceCurrency === "USD" ? "USD wire" : "paid in USD",
    providers: i.providers,
    payBy: i.payBy,
    routeLabel: snap ? routeLabel(snap) : null,
    routeRuleId: check.choice ? (chosenEst?.result.options.find((o) => o.optionId === check.choice!.optionId)?.ruleId ?? null) : null,
    expected,
    expectedIsModelled: true,
    shortfall,
    actual,
    ourError,
    quoteError,
    hasQuote: check.quotes.length > 0 || !!snap?.quote,
    insideRange,
    replyDue: check.choice?.replyDue ?? null,
    replyOverdue: overdue,
    evidence: level,
    chips,
    attention,
  };
}
export type CheckListItem = ReturnType<typeof listItem>;

function verdictText(v: Verdict, opts: OptionEstimate[], payBy: string): { tone: Tone; title: string; body: string } {
  const label = (id: string) => opts.find((o) => o.optionId === id)?.label ?? id;
  switch (v.kind) {
    case "favoured": {
      const o = opts.find((x) => x.optionId === v.optionId)!;
      const rivalsHigh = opts.filter((x) => x.optionId !== o.optionId).reduce((m, x) => (dec(x.high).gt(m) ? dec(x.high) : m), dec(0));
      const gap = dec(o.low!).minus(rivalsHigh).toFixed();
      return {
        tone: "ok",
        title: `${o.label} is likely to deliver more`,
        body: `Its low estimate is ${fmtMoney(gap, o.destCurrency)} above the highest estimate of any other route, so the ranges do not overlap. Typical difference ${fmtMoney(v.marginOverNext, o.destCurrency)}.`,
      };
    }
    case "too_close":
      return {
        tone: "neutral",
        title: "Too close to call",
        body: `The ranges of ${v.optionIds.map(label).join(" and ")} overlap, so no rank is given. Compare the provider quotes, speed and what you pay.`,
      };
    case "unrankable":
      return { tone: "warn", title: "No route can be ranked confidently", body: `${v.reason} Rough figures exclude the unknown cost, so they can only be lower.` };
    case "single":
      return { tone: "neutral", title: `Only one eligible route: ${label(v.optionId)}`, body: "There is nothing to compare it against. Its range is shown below." };
    case "none_eligible":
      return {
        tone: "error",
        title: v.reason.startsWith("Nothing arrives") ? `Nothing arrives by ${fmtDay(payBy)}` : "No eligible route",
        body: "Change the deadline or the available providers.",
      };
    case "cover": {
      const p = opts.find((o) => o.optionId === v.plannedOptionId)!;
      const top = v.topUpOptionId ? opts.find((o) => o.optionId === v.topUpOptionId)! : null;
      if (v.covers === "even_low") return { tone: "ok", title: "The full amount should arrive", body: `Even the low estimate of ${fmtMoney(p.low, p.destCurrency)} covers the invoice.` };
      return {
        tone: "short",
        title: "Not for certain as planned",
        body: top
          ? `Send ${fmtMoney(top.sendAmount, top.sourceCurrency)} with ${p.optionLabel} and even the low estimate covers the invoice. You pay ${fmtMoney(top.youPay, top.sourceCurrency)} including the wire fee.`
          : COVER_LABEL[v.covers],
      };
    }
  }
}

function optionSentences(o: OptionEstimate, mode: "compare" | "cover", invoice: { amount: string; currency: string }) {
  const cur = o.destCurrency;
  const lead =
    mode === "cover"
      ? `Sending ${fmtMoney(o.sendAmount, o.sourceCurrency)}${o.optionLabel ? ` with ${o.optionLabel === "SHA" ? "shared charges" : o.optionLabel === "OUR" ? "all charges paid by you" : "all charges paid by the supplier"}` : ""}: about ${fmtMoney(o.typical, cur)}${o.low ? `, at least ${fmtMoney(o.low, cur)}` : ""} (modelled).`
      : o.rough
        ? `At most about ${fmtMoney(o.typical, cur)} (rough, modelled): ${o.missing.join(" and ")} unknown.`
        : `About ${fmtMoney(o.typical, cur)}, at least ${fmtMoney(o.low, cur)} (modelled).`;
  const parts: string[] = [];
  parts.push(`Sending ${fmtMoney(o.sendAmount, o.sourceCurrency, 2)}${o.youPay ? `; you pay ${fmtMoney(o.youPay, o.sourceCurrency, 2)} with the sending fee` : ""}.`);
  const sf = dec(o.shortfallTypical);
  if (sf.gt(0)) parts.push(`Typical shortfall ${fmtMoney(o.shortfallTypical, cur)}.`);
  else if (sf.lt(0)) parts.push(`Typical surplus ${fmtMoney(sf.neg().toFixed(), cur)}.`);
  if (o.coverSend.typical && o.coverSend.low && o.covers !== "even_low" && mode === "compare") {
    parts.push(`To cover the invoice send about ${fmtMoney(o.coverSend.typical, o.sourceCurrency, 2)}, or ${fmtMoney(o.coverSend.low, o.sourceCurrency, 2)} to cover it even in the low case.`);
  }
  if (o.covers === "even_low") parts.push("Even the low estimate covers the invoice.");
  void invoice;
  return { lead, sub: parts.join(" ") };
}

function quoteView(db: Database, check: Check, est: EstimateSnapshot) {
  return check.quotes.map((q) => {
    const option = est.result.options.find((o) => o.ruleId === q.ruleId && !o.isTopUp);
    const rule = est.rules.find((r) => r.id === q.ruleId);
    let analysis: ReturnType<typeof analyseQuote> | null = null;
    if (option && rule) {
      try {
        analysis = analyseQuote({
          rule,
          rate: est.rate,
          sendAmount: option.sendAmount,
          quote: q.kind === "amount" ? { kind: "amount", amount: q.value } : { kind: "rate", rate: q.value },
          typical: option.typical,
          low: option.low,
          high: option.high,
        });
      } catch {
        analysis = null;
      }
    }
    const cur = option?.destCurrency ?? "MXN";
    let sentence = "";
    if (analysis && option) {
      const d = dec(analysis.diffFromTypical);
      const pos = d.isZero() ? "Equal to our typical" : `${fmtMoney(d.abs().toFixed(), cur)} ${d.gt(0) ? "above" : "below"} our typical`;
      const range = analysis.insideRange === null ? "" : analysis.insideRange ? ", inside our range" : ", outside our range";
      const mk = analysis.impliedMarkupPct
        ? ` The quote implies about a ${fmtPct(analysis.impliedMarkupPct)} markup; we assume ${fmtPct(option.cases.typical.markupPct, 2)}.`
        : "";
      sentence = `${pos}${range}.${mk}`;
    }
    return {
      ...q,
      routeLabel: rule ? rule.routeName : q.ruleId,
      currency: cur,
      byName: userName(db, q.by),
      analysis,
      sentence,
      current: latestQuoteFor(check, q.ruleId)?.id === q.id,
    };
  });
}

function reconciliationView(check: Check, est: EstimateSnapshot | null, outcome: Outcome | null) {
  if (!check.choice || !outcome || outcome.result !== "received" || !outcome.amount) return null;
  const s = check.choice.snapshot;
  const invoiceComparable = check.inputs.invoiceCurrency === s.currency;
  const r = reconcile({
    typical: s.typical,
    low: s.low,
    high: s.high,
    actual: outcome.amount,
    invoice: invoiceComparable ? check.inputs.invoiceAmount : null,
    quote: s.quote,
  });
  const cur = s.currency;
  const who =
    outcome.level === "verified"
      ? "A validated SPEI receipt (CEP) shows"
      : outcome.reportedBy === "supplier"
        ? "The supplier reports"
        : outcome.reportedBy === "payer"
          ? "You report"
          : "A bank or provider statement (not validated) shows";
  const facts: string[] = [];
  facts.push(r.actualVsTypical === "equal" ? "equal to our typical estimate" : `${r.actualVsTypical} our typical estimate`);
  if (r.insideRange !== null) facts.push(r.insideRange ? "inside our range" : "outside our range");
  if (r.actualVsQuote) facts.push(r.actualVsQuote === "equal" ? "equal to the provider's quote" : `${r.actualVsQuote} the provider's quote`);
  const last = facts.length > 1 ? `, and ${facts.pop()}` : "";
  const sentence = `${who} ${fmtMoney(outcome.amount, cur)}: ${facts.join(", ")}${last}.`;

  const unknowns: string[] = [];
  if (outcome.level === "demo_verified") unknowns.push("Only a DEMO receipt file was checked. No real bank record or CEP has passed validation.");
  else if (outcome.level !== "verified") unknowns.push("No bank record or CEP has passed validation.");
  if (!dec(r.ourError).isZero()) unknowns.push(`The cause of the ${fmtMoney(dec(r.ourError).abs().toFixed(), cur)} difference is not established.`);
  if (outcome.level === "tax_record") unknowns.push("A tax record may show the full rather than the net amount.");

  // Where identifiable: if the deductions and fees were as assumed, what markup does the actual imply?
  let feeNote = "Individual fee differences are not identifiable: only the total received is known.";
  const option = est?.result.options.find((o) => o.optionId === check.choice!.optionId);
  const rule = est?.rules.find((x) => x.id === option?.ruleId) as FeeRule | undefined;
  if (option && rule && rule.sourceCurrency !== rule.destCurrency && est) {
    try {
      const a = analyseQuote({ rule, rate: est.rate, sendAmount: option.sendAmount, quote: { kind: "amount", amount: outcome.amount }, typical: option.typical, low: option.low, high: option.high });
      if (a.impliedMarkupPct) {
        feeNote += ` If deductions and fees were as assumed, the amount received implies a markup of about ${fmtPct(a.impliedMarkupPct)} (we assumed ${fmtPct(option.cases.typical.markupPct)}). This is an inference, not an observation.`;
      }
    } catch {
      /* not derivable */
    }
  } else if (option && rule) {
    const implied = dec(option.sendAmount).minus(dec(outcome.amount));
    feeNote += ` In total ${fmtMoney(implied.toFixed(), cur)} was deducted between sending and receipt (we assumed ${fmtMoney(option.cases.typical.deduction, cur)}).`;
  }

  return {
    ...r,
    currency: cur,
    expected: s.typical,
    low: s.low,
    high: s.high,
    actual: outcome.amount,
    quote: s.quote,
    invoice: invoiceComparable ? check.inputs.invoiceAmount : null,
    sentence,
    unknowns,
    feeNote,
    level: outcome.level,
    reportedBy: outcome.reportedBy,
    reportedByLabel: outcome.reportedBy ? REPORTED_BY_LABEL[outcome.reportedBy] : null,
    date: outcome.date,
  };
}

export function checkDetail(db: Database, check: Check, nowMs: number) {
  const summary = listItem(db, check, nowMs);
  const est = latestEstimate(check);
  const chosenEst = check.choice ? check.estimates.find((e) => e.id === check.choice!.estimateId) ?? null : null;
  const shown = chosenEst ?? est;
  const outcome = currentOutcome(check);

  let estimate = null;
  if (shown && !(check.calcError && !chosenEst)) {
    const rate = shown.rate ? rateFreshness(shown.rate.retrievedAt, nowMs) : null;
    const latest = currentRate(db);
    const latestFresh = latest ? rateFreshness(latest.retrievedAt, nowMs) : null;
    const focus = focusOption(shown, check);
    const v = shown.result.verdict;
    const favouredId = v.kind === "favoured" ? v.optionId : null;
    const invoice = { amount: check.inputs.invoiceAmount, currency: check.inputs.invoiceCurrency };
    const sorted =
      v.kind === "favoured"
        ? [...shown.result.options].sort((a, b) => dec(b.typical).cmp(dec(a.typical)))
        : shown.result.options;
    const options = sorted.map((o) => {
      const rule = shown.rules.find((r) => r.id === o.ruleId)!;
      const s = optionSentences(o, shown.result.mode, invoice);
      const q = latestQuoteFor(check, o.ruleId);
      return {
        ...o,
        displayLabel: routeLabel(o),
        rule: { source: rule.source, classification: rule.classification, lastVerifiedAt: rule.lastVerifiedAt, eligibilityNote: rule.eligibilityNote, feePayer: rule.feePayer, scheduleAgeDays: scheduleFreshness(rule.lastVerifiedAt, nowMs).days },
        isFavoured: o.optionId === favouredId,
        isPlanned: v.kind === "cover" && v.plannedOptionId === o.optionId,
        isChosen: check.choice?.optionId === o.optionId && check.choice.estimateId === shown.id,
        coverLabel: COVER_LABEL[o.covers],
        quoteReceipt: q && !o.isTopUp ? q.quotedReceipt : null,
        ...s,
      };
    });
    estimate = {
      id: shown.id,
      isChosenSnapshot: !!chosenEst,
      computedAt: shown.computedAt,
      calcVersion: shown.calcVersion,
      scheduleVersion: shown.scheduleVersion,
      rate: shown.rate,
      rateAgeHours: rate?.hours ?? null,
      rateAgeLabel: rate ? fmtAgeHours(rate.hours) : null,
      rateStale: rate?.stale ?? false,
      rateWarn: rate?.warn ?? false,
      newerRateAvailable: !!latest && !!shown.rate && latest.id !== shown.rate.id && !latestFresh?.stale,
      latestRateStale: latestFresh?.stale ?? true,
      mode: shown.result.mode,
      options,
      excluded: shown.result.excluded,
      verdict: v,
      verdictText: verdictText(v, shown.result.options, check.inputs.payBy),
      grossAtMid: shown.result.grossAtMid,
      focusOptionId: focus?.optionId ?? null,
      inputs: shown.inputs,
    };
  }

  const reconciliation = reconciliationView(check, chosenEst, outcome);
  const today = ymd(nowMs);
  // UI affordances only. Authorization is enforced server-side on every request (src/server/auth/authz.ts).
  const canAct = !check.archived && db.users.find((u) => u.id === db.currentUserId)?.access !== "viewer";
  return {
    summary,
    inputs: check.inputs,
    estimate,
    estimateHistory: check.estimates.map((e) => ({
      id: e.id,
      computedAt: e.computedAt,
      scheduleVersion: e.scheduleVersion,
      calcVersion: e.calcVersion,
      rate: e.rate?.rate ?? null,
      isShown: e.id === shown?.id,
    })),
    calcError: check.calcError,
    quotes: shown ? quoteView(db, check, shown) : [],
    choice: check.choice ? { ...check.choice, byName: userName(db, check.choice.by), displayLabel: routeLabel(check.choice.snapshot) } : null,
    outcome: outcome ? { ...outcome, byName: userName(db, outcome.by) } : null,
    outcomeHistory: check.outcomes.map((o) => ({ ...o, byName: userName(db, o.by) })),
    reconciliation,
    evidence: check.evidence,
    planChange: check.planChanges.length ? check.planChanges[check.planChanges.length - 1].answer : null,
    events: check.events.map((e) => ({ ...e, actorName: userName(db, e.actor) })),
    actions: {
      canEditInputs: canAct && !check.choice,
      canRecalculate: canAct && !check.choice && (check.status === "choose_route" || check.status === "draft"),
      canAddQuote: canAct && check.status === "choose_route" && !!estimate,
      canRecordChoice: canAct && check.status === "choose_route" && !!estimate && !check.calcError && estimate.options.length > 0,
      canRecordOutcome: canAct && (check.status === "awaiting_receipt" || check.status === "no_reply"),
      canCorrect: canAct && check.status === "reconciled",
      canAddEvidence: canAct && !!check.choice && check.status !== "refused",
      replyOverdue: isOverdue(check, today),
    },
    defaultView:
      check.status === "reconciled"
        ? ("reconciled" as const)
        : check.status === "awaiting_receipt" || check.status === "no_reply" || check.status === "refused"
          ? ("outcome" as const)
          : ("compare" as const),
  };
}
export type CheckDetailView = ReturnType<typeof checkDetail>;

export function inbox(db: Database, nowMs: number) {
  const today = ymd(nowMs);
  const items: { id: string; checkId: string; supplierHash: string; tone: Tone; title: string; body: string; at: string; href: string; kind: string }[] = [];
  for (const c of db.checks) {
    if (c.archived) continue;
    const est = latestEstimate(c);
    if (c.status === "awaiting_receipt" && c.choice && c.choice.replyDue < today) {
      const days = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${c.choice.replyDue}T12:00:00`).getTime()) / 86_400_000);
      items.push({ id: `${c.id}:overdue`, checkId: c.id, supplierHash: c.supplierHash, tone: "short", kind: "Reply overdue", title: "Reply overdue", body: `Due ${fmtDay(c.choice.replyDue)}. Record No reply or send a reminder.`, at: new Date(`${c.choice.replyDue}T23:59:00`).toISOString(), href: `/checks/${c.id}/outcome` });
      void days;
    }
    if (c.calcError) {
      items.push({ id: `${c.id}:calc`, checkId: c.id, supplierHash: c.supplierHash, tone: "error", kind: "Failed calculation", title: "Calculation failed", body: "Inputs are saved and no amounts are shown. Retry the calculation.", at: c.calcError.at, href: `/checks/${c.id}` });
    }
    if (c.status === "draft") {
      items.push({ id: `${c.id}:draft`, checkId: c.id, supplierHash: c.supplierHash, tone: "neutral", kind: "Draft", title: "Draft not compared", body: "Inputs are saved. Compare routes when you are ready.", at: c.updatedAt, href: `/checks/${c.id}` });
    }
    if (c.status === "choose_route" && est && !c.calcError) {
      if (est.rate) {
        const f = rateFreshness(est.rate.retrievedAt, nowMs);
        if (f.stale) {
          items.push({ id: `${c.id}:stale`, checkId: c.id, supplierHash: c.supplierHash, tone: "warn", kind: "Stale rate", title: `Rate is ${Math.floor(f.hours)} hours old`, body: "Amounts are labelled stale. Update the rate before recording a choice, or confirm you accept it.", at: new Date(new Date(est.rate.retrievedAt).getTime() + FRESHNESS.rateStaleAfterHours * 3_600_000).toISOString(), href: `/checks/${c.id}` });
        } else if (f.warn) {
          const at = new Date(new Date(est.rate.retrievedAt).getTime() + FRESHNESS.rateStaleAfterHours * 3_600_000);
          items.push({ id: `${c.id}:warn`, checkId: c.id, supplierHash: c.supplierHash, tone: "warn", kind: "Stale rate", title: `Rate turns 24 hours old at ${fmtStamp(at.toISOString())}`, body: "Record a choice before then, or update the rate.", at: est.computedAt, href: `/checks/${c.id}` });
        }
      }
      if (est.result.verdict.kind === "unrankable") {
        items.push({ id: `${c.id}:rough`, checkId: c.id, supplierHash: c.supplierHash, tone: "warn", kind: "Incomplete evidence", title: "Incomplete fee data", body: est.result.verdict.reason, at: est.computedAt, href: `/checks/${c.id}/evidence` });
      }
      if (est.result.verdict.kind === "none_eligible") {
        items.push({ id: `${c.id}:none`, checkId: c.id, supplierHash: c.supplierHash, tone: "error", kind: "No eligible route", title: "No eligible route", body: `${est.result.verdict.reason} Change the deadline or the providers.`, at: est.computedAt, href: `/checks/${c.id}` });
      }
    }
    if (c.status === "reconciled" && c.choice) {
      const o = currentOutcome(c);
      if (o?.amount) {
        const s = c.choice.snapshot;
        const r = reconcile({ typical: s.typical, low: s.low, high: s.high, actual: o.amount, invoice: null, quote: s.quote });
        if (r.insideRange === false) {
          items.push({ id: `${c.id}:variance`, checkId: c.id, supplierHash: c.supplierHash, tone: "short", kind: "Unusual variance", title: `Actual fell outside the range by ${fmtMoney(dec(r.ourError).abs().toFixed(), s.currency)}`, body: `${fmtMoney(o.amount, s.currency)} received against a modelled range of ${fmtNum(s.low ?? "0")} to ${fmtNum(s.high)}. Review the fee schedule for ${s.label}.`, at: o.at, href: `/checks/${c.id}/reconciled` });
        }
      }
    }
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  return items;
}
export type InboxItem = ReturnType<typeof inbox>[number];

export function overview(db: Database, nowMs: number) {
  const live = db.checks.filter((c) => !c.archived);
  const items = live.map((c) => listItem(db, c, nowMs));
  const sumBy = (cur: string, f: (i: CheckListItem) => { value: string; currency: string } | null) =>
    items.reduce((acc, i) => {
      const v = f(i);
      return v && v.currency === cur ? acc.plus(dec(v.value)) : acc;
    }, dec(0));
  const reconciled = items.filter((i) => i.insideRange !== null);
  const events = [
    ...db.checks.flatMap((c) => c.events.map((e) => ({ ...e, checkId: c.id as string | null, supplierHash: c.supplierHash as string | null }))),
    ...db.configEvents.map((e) => ({ ...e, type: e.type as string, checkId: null, supplierHash: null })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12)
    .map((e) => ({ ...e, actorName: userName(db, e.actor) }));
  return {
    metrics: {
      total: items.length,
      mine: items.filter((i) => i.mine).length,
      valueCheckedUsd: items.filter((i) => i.status !== "draft").reduce((acc, i) => acc.plus(dec(i.sendAmount)), dec(0)).toFixed(),
      awaitingOutcome: items.filter((i) => i.status === "awaiting_receipt").length,
      overdue: items.filter((i) => i.replyOverdue).length,
      attention: items.filter((i) => i.attention.length > 0).length,
      open: items.filter((i) => i.status === "choose_route" || i.status === "draft").length,
      shortfallMxn: sumBy("MXN", (i) => i.shortfall).toFixed(),
      shortfallUsd: sumBy("USD", (i) => i.shortfall).toFixed(),
      reconciled: reconciled.length,
      insideRange: reconciled.filter((i) => i.insideRange).length,
    },
    recent: [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
    activity: events,
  };
}

export function audit(db: Database) {
  return [
    ...db.checks.flatMap((c) => c.events.map((e) => ({ ...e, type: e.type as string, scope: "check" as const, checkId: c.id as string | null, supplierHash: c.supplierHash as string | null }))),
    ...db.configEvents.map((e) => ({ ...e, type: e.type as string, scope: "config" as const, checkId: null, supplierHash: null })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
    .map((e) => ({ ...e, actorName: userName(db, e.actor) }));
}
export type AuditEntry = ReturnType<typeof audit>[number];

export function sources(db: Database, nowMs: number) {
  const rate = currentRate(db);
  const sched = currentSchedule(db);
  const rf = rate ? rateFreshness(rate.retrievedAt, nowMs) : null;
  const sf = scheduleFreshness(sched.publishedAt, nowMs);
  const quotes = db.checks.flatMap((c) => c.quotes);
  const outcomes = db.checks.flatMap((c) => c.outcomes);
  const ceps = db.checks.flatMap((c) => c.evidence);
  const lastAt = (xs: { at: string }[]) => (xs.length ? xs.map((x) => x.at).sort().at(-1)! : null);
  return {
    rate,
    rates: [...db.rates].sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt)).slice(0, 8),
    list: [
      {
        id: "rate",
        name: rate?.isDemo ? "Sample USD/MXN rate" : rate?.classification === "published" ? "USD/MXN reference FX rate" : "USD/MXN rate, manually entered",
        category: "Benchmark FX rate",
        corridor: "US → MX",
        lastAt: rate?.retrievedAt ?? null,
        freshness: rf ? `${fmtAgeHours(rf.hours)} old` : "none",
        status: !rate ? ("error" as const) : rf!.stale ? ("warn" as const) : ("ok" as const),
        statusLabel: !rate ? "Missing" : rf!.stale ? "Stale" : rf!.warn ? "Ageing" : "Fresh",
        classification: (rate?.classification === "published" ? "published" : "manual") as SourceClass,
        limitation:
          rate?.classification === "published"
            ? `Reference rate from ${rate.benchmarkProvider === "currencyapi" ? "currencyapi.com" : "Frankfurter"}, observed ${rate.observedAt ? rate.observedAt.slice(0, 10) : "on an unknown date"}. Not any provider's offered rate and not a guaranteed transfer rate. Refetch daily: stale for new choices after 24 hours.`
            : "Entered by hand. The demo rate is illustrative, not a market quote. Stale after 24 hours.",
      },
      {
        id: "schedule",
        name: `Fee schedule v${sched.version}`,
        category: "Fees, markups and deductions",
        corridor: "US → MX",
        lastAt: sched.publishedAt,
        freshness: `${fmtAgeHours(sf.days * 24)} old`,
        status: sf.stale ? ("warn" as const) : ("ok" as const),
        statusLabel: sf.stale ? "Stale" : "Current",
        classification: "modelled" as const,
        limitation: "Demo assumptions configured by hand. Not taken from any provider's published schedule. Stale after 30 days (proposed).",
      },
      {
        id: "quotes",
        name: "Provider quotes",
        category: "Quote entered by the customer",
        corridor: "US → MX",
        lastAt: lastAt(quotes),
        freshness: `${quotes.length} recorded`,
        status: "ok" as const,
        statusLabel: "Manual",
        classification: "provider_quote" as const,
        limitation: "Typed in by the user from the provider's screen. Not fetched; no provider API is integrated.",
      },
      {
        id: "outcomes",
        name: "Outcome reports",
        category: "Actual amount received",
        corridor: "US → MX",
        lastAt: lastAt(outcomes),
        freshness: `${outcomes.length} recorded`,
        status: "ok" as const,
        statusLabel: "Manual",
        classification: "supplier_reported" as const,
        limitation: "Stated by the supplier or by you. Reported amounts are not verified unless a receipt check passes.",
      },
      {
        id: "cep",
        name: "SPEI receipt (CEP) check",
        category: "Receipt validation",
        corridor: "Mexico (SPEI)",
        lastAt: lastAt(ceps),
        freshness: `${ceps.length} checks`,
        status: "warn" as const,
        statusLabel: "Demo only",
        classification: "bank_confirmed" as const,
        limitation: "Demo fixtures only: no file is parsed and Banxico is never contacted. A CEP confirms a known amount; it cannot discover an unknown shortfall.",
      },
    ],
  };
}

export function routesView(db: Database, nowMs: number) {
  const sched = currentSchedule(db);
  return sched.rules.map((r) => {
    const used = db.checks.filter((c) => c.estimates.some((e) => e.result.options.some((o) => o.ruleId === r.id)));
    const chosen = db.checks.filter((c) => {
      if (!c.choice) return false;
      const e = c.estimates.find((x) => x.id === c.choice!.estimateId);
      return e?.result.options.find((o) => o.optionId === c.choice!.optionId)?.ruleId === r.id;
    });
    const errors = chosen
      .map((c) => {
        const o = currentOutcome(c);
        if (!o?.amount || !c.choice) return null;
        return reconcile({ typical: c.choice.snapshot.typical, low: c.choice.snapshot.low, high: c.choice.snapshot.high, actual: o.amount, invoice: null, quote: null });
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    const sf = scheduleFreshness(r.lastVerifiedAt, nowMs);
    const missing = [r.senderFee === null && "sender fee", r.markupPct === null && r.method !== "usd_wire" && "markup", r.deduction === null && "deductions", r.receivingFee === null && "receiving fee"].filter(Boolean) as string[];
    return {
      id: r.id,
      provider: r.providerName,
      providerKind: PROVIDERS.find((p) => p.id === r.providerId)?.kind ?? "",
      route: r.optionLabel ? `${r.routeName} (${r.optionLabel})` : r.routeName,
      method: r.method,
      corridor: r.destCurrency === "USD" ? "USD → USD" : "USD → MXN",
      speed: r.speedLabel,
      eligibility: r.eligibility,
      eligibilityNote: r.eligibilityNote,
      lastVerifiedAt: r.lastVerifiedAt,
      scheduleStale: sf.stale,
      source: r.source,
      classification: r.classification,
      missing,
      typicalMarkup: r.markupPct?.typical ?? null,
      senderFee: r.senderFee,
      checksUsed: used.length,
      timesChosen: chosen.length,
      outcomes: errors.length,
      insideRange: errors.filter((e) => e.insideRange).length,
      meanError: errors.length ? errors.reduce((a, e) => a.plus(dec(e.ourError)), dec(0)).div(errors.length).toFixed() : null,
      destCurrency: r.destCurrency,
      providerName: providerName(r.providerId),
    };
  });
}
