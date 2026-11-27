import { analyseQuote, EngineError, FRESHNESS, rateFreshness, dec, type FeeRule } from "@/engine";
import { addDays, fmtDay, fmtMoney, fmtNum, ymd } from "@/lib/format";
import { PAYOUT_LABEL, PLAN_CHANGE_LABEL, REPORTED_BY_LABEL } from "@/lib/labels";
import {
  addEvent,
  nextId,
  buildEstimate,
  currentRate,
  estimateById,
  estimateMessage,
  getCheck,
  iso,
  latestEstimate,
  nextCheckId,
  ServiceError,
} from "../core";
import type { Check, CheckInputs, CheckStatus, Database, EvidenceRecord, Outcome, PlanChange } from "../model";
import { providerName } from "../demo-data";
import { canTransition } from "../invariants";
import { demoVerify, type ReceiptClaim, type VerificationResult } from "../verification";

interface Ctx {
  actor: string;
  nowMs: number;
}

function assertNotArchived(check: Check) {
  if (check.archived) throw new ServiceError(409, "ARCHIVED", `${check.id} is archived. Restore it to make changes.`);
}

/** Every status change goes through the lifecycle table in invariants.ts. */
function transition(check: Check, to: CheckStatus) {
  if (check.status === to) return;
  if (!canTransition(check.status, to)) {
    throw new ServiceError(409, "STATE", `A check cannot move from "${check.status}" to "${to}".`);
  }
  check.status = to;
}

function tryEstimate(db: Database, check: Check, ctx: Ctx) {
  try {
    const est = buildEstimate(db, check.inputs, ctx.nowMs);
    check.estimates.push(est);
    check.calcError = null;
    addEvent(db, check, "system", "estimate_computed", estimateMessage(est), ctx.nowMs);
    return est;
  } catch (e) {
    if (e instanceof EngineError) {
      check.calcError = { at: iso(ctx.nowMs), code: e.code, message: e.message };
      addEvent(db, check, "system", "calc_failed", `Calculation failed: ${e.message} Inputs are saved; no amounts are shown.`, ctx.nowMs);
      return null;
    }
    throw e;
  }
}

export function createCheck(
  db: Database,
  body: CheckInputs & { supplierHash: string; draft: boolean; quote?: { ruleId: string; kind: "amount" | "rate"; value: string } | null },
  ctx: Ctx,
): Check {
  if (body.payBy < ymd(ctx.nowMs)) {
    throw new ServiceError(422, "VALIDATION", "Choose today or a later date.", { payBy: "Choose today or a later date." });
  }
  const { supplierHash, draft, quote, ...inputs } = body;
  const check: Check = {
    id: nextCheckId(db),
    createdAt: iso(ctx.nowMs),
    createdBy: ctx.actor,
    updatedAt: iso(ctx.nowMs),
    supplierHash,
    status: draft ? "draft" : "choose_route",
    archived: false,
    inputs,
    estimates: [],
    calcError: null,
    quotes: [],
    choice: null,
    outcomes: [],
    evidence: [],
    planChanges: [],
    events: [],
    isDemo: false,
  };
  db.checks.push(check);
  addEvent(db, check, ctx.actor, draft ? "draft_saved" : "created", draft ? "saved a draft" : "created the check", ctx.nowMs);
  if (!draft) {
    const est = tryEstimate(db, check, ctx);
    if (est && quote) addQuote(db, check.id, { ...quote, validUntil: null }, ctx);
  }
  return check;
}

const INPUT_LABELS: Partial<Record<keyof CheckInputs, string>> = {
  invoiceAmount: "invoice amount",
  invoiceCurrency: "invoice currency",
  sendAmount: "amount to send",
  payBy: "pay-by date",
  payoutMethod: "supplier payout",
  providers: "providers",
  invoiceRef: "invoice reference",
  chargeCode: "charge code",
};

function describeValue(key: keyof CheckInputs, v: unknown, inputs: CheckInputs): string {
  if (key === "payBy") return fmtDay(String(v));
  if (key === "providers") return (v as string[]).map(providerName).join(", ");
  if (key === "payoutMethod") return PAYOUT_LABEL[v as keyof typeof PAYOUT_LABEL];
  if (key === "invoiceAmount") return fmtMoney(String(v), inputs.invoiceCurrency, 2);
  if (key === "sendAmount") return fmtMoney(String(v), "USD", 2);
  return v === null ? "none" : String(v);
}

/** Editing inputs never rewrites history: it appends a new estimate snapshot. Locked once a route is chosen. */
export function updateInputs(db: Database, id: string, patch: Partial<CheckInputs>, ctx: Ctx): Check {
  const check = getCheck(db, id);
  assertNotArchived(check);
  if (check.choice) {
    throw new ServiceError(409, "LOCKED", "A route has been recorded, so inputs are locked. Duplicate the check to try other inputs.");
  }
  if (patch.payBy && patch.payBy < ymd(ctx.nowMs)) {
    throw new ServiceError(422, "VALIDATION", "Choose today or a later date.", { payBy: "Choose today or a later date." });
  }
  const before = structuredClone(check.inputs);
  const next = { ...check.inputs, ...patch };
  const changes: string[] = [];
  for (const key of Object.keys(INPUT_LABELS) as (keyof CheckInputs)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(next[key])) {
      changes.push(`${INPUT_LABELS[key]} set to ${describeValue(key, next[key], next)}`);
    }
  }
  if (changes.length === 0) return check;
  check.inputs = next;
  addEvent(db, check, ctx.actor, "inputs_modified", `Input modified: ${changes.join("; ")}`, ctx.nowMs);
  if (check.status === "draft") transition(check, "choose_route");
  tryEstimate(db, check, ctx);
  return check;
}

/** Retry a failed calculation, compute a draft, or re-run with the current rate. Old snapshots are kept. */
export function recalculate(db: Database, id: string, ctx: Ctx): Check {
  const check = getCheck(db, id);
  assertNotArchived(check);
  if (check.choice) throw new ServiceError(409, "LOCKED", "A route has been recorded; the chosen estimate is frozen.");
  if (check.status === "draft") {
    transition(check, "choose_route");
    addEvent(db, check, ctx.actor, "created", "submitted the draft for comparison", ctx.nowMs);
  }
  tryEstimate(db, check, ctx);
  return check;
}

export function addQuote(
  db: Database,
  id: string,
  body: { ruleId: string; kind: "amount" | "rate"; value: string; validUntil?: string | null },
  ctx: Ctx,
): Check {
  const check = getCheck(db, id);
  assertNotArchived(check);
  if (check.choice) throw new ServiceError(409, "LOCKED", "The route is already recorded. Quotes must be entered before paying.");
  const est = latestEstimate(check);
  if (!est) throw new ServiceError(409, "NO_ESTIMATE", "Compare routes before adding a quote.");
  const option = est.result.options.find((o) => o.ruleId === body.ruleId && !o.isTopUp);
  if (!option) throw new ServiceError(422, "VALIDATION", "That route is not eligible for this check.", { ruleId: "Choose an eligible route." });
  const rule = est.rules.find((r) => r.id === body.ruleId) as FeeRule;
  let analysis;
  try {
    analysis = analyseQuote({
      rule,
      rate: est.rate,
      sendAmount: option.sendAmount,
      quote: body.kind === "amount" ? { kind: "amount", amount: body.value } : { kind: "rate", rate: body.value },
      typical: option.typical,
      low: option.low,
      high: option.high,
    });
  } catch (e) {
    if (e instanceof EngineError) throw new ServiceError(422, "VALIDATION", e.message, { value: e.message });
    throw e;
  }
  // Sanity guard: a quote far from the estimate is usually a typo (e.g. USD entered as MXN).
  const ratio = dec(analysis.quotedReceipt).div(dec(option.typical));
  if (ratio.lt(0.8) || ratio.gt(1.2)) {
    const msg = `This quote is more than 20% away from the estimate (${fmtMoney(option.typical, option.destCurrency)}). Check the currency and amount.`;
    throw new ServiceError(422, "VALIDATION", msg, { value: msg });
  }
  check.quotes.push({
    id: nextId(db, "q"),
    at: iso(ctx.nowMs),
    by: ctx.actor,
    ruleId: body.ruleId,
    kind: body.kind,
    value: body.value,
    quotedReceipt: analysis.quotedReceipt,
    impliedMarkupPct: analysis.impliedMarkupPct,
    estimateId: est.id,
    validUntil: body.validUntil ?? null,
  });
  const what = body.kind === "amount" ? fmtMoney(body.value, option.destCurrency) : `rate ${body.value} (${fmtMoney(analysis.quotedReceipt, option.destCurrency)})`;
  addEvent(db, check, ctx.actor, "quote_added", `${providerName(rule.providerId)} quote added, ${what}`, ctx.nowMs);
  return check;
}

export function latestQuoteFor(check: Check, ruleId: string) {
  const list = check.quotes.filter((q) => q.ruleId === ruleId);
  return list.length ? list[list.length - 1] : null;
}

export function recordChoice(db: Database, id: string, body: { optionId: string; paidOn: string; confirmStale: boolean }, ctx: Ctx): Check {
  const check = getCheck(db, id);
  assertNotArchived(check);
  if (check.status !== "choose_route") throw new ServiceError(409, "STATE", `A choice can only be recorded while the check is in "Choose route".`);
  const est = latestEstimate(check);
  if (!est || check.calcError) throw new ServiceError(409, "NO_ESTIMATE", "There is no valid estimate to choose from.");
  const option = est.result.options.find((o) => o.optionId === body.optionId);
  if (!option) throw new ServiceError(422, "VALIDATION", "That option is not eligible for this check.");
  const fresh = est.rate ? rateFreshness(est.rate.retrievedAt, ctx.nowMs) : { hours: 0, stale: false };
  if (fresh.stale && !body.confirmStale) {
    throw new ServiceError(409, "STALE_RATE", `The rate is ${Math.floor(fresh.hours)} hours old.`, undefined, { hours: Math.floor(fresh.hours) });
  }
  const quote = latestQuoteFor(check, option.ruleId);
  check.choice = {
    id: nextId(db, "ch"),
    at: iso(ctx.nowMs),
    by: ctx.actor,
    optionId: option.optionId,
    estimateId: est.id,
    paidOn: body.paidOn,
    replyDue: addDays(body.paidOn, FRESHNESS.replyWindowDays),
    recordedStale: fresh.stale,
    rateAgeHours: Math.floor(fresh.hours),
    snapshot: {
      label: option.label,
      optionLabel: option.optionLabel,
      isTopUp: option.isTopUp,
      sendAmount: option.sendAmount,
      youPay: option.youPay,
      low: option.low,
      typical: option.typical,
      high: option.high,
      currency: option.destCurrency,
      quote: quote && !option.isTopUp ? quote.quotedReceipt : null,
    },
  };
  transition(check, "awaiting_receipt");
  const label = option.optionLabel ? `${option.label} ${option.optionLabel}, send ${fmtNum(option.sendAmount, 2)}` : option.label;
  addEvent(
    db,
    check,
    ctx.actor,
    "route_selected",
    `Route selected: ${label}${fresh.stale ? ` (recorded with a ${Math.floor(fresh.hours)}-hour-old rate, marked stale)` : ""}. No money was sent.`,
    ctx.nowMs,
  );
  return check;
}

export function currentOutcome(check: Check): Outcome | null {
  return check.outcomes.length ? check.outcomes[check.outcomes.length - 1] : null;
}

type OutcomeBody =
  | { result: "received"; amount: string; date: string; reportedBy: "supplier" | "payer" | "provider_statement"; reference?: string | null; level: "reported" | "tax_record"; evidenceId?: string | null }
  | { result: "no_reply"; date: string }
  | { result: "refused"; date: string; reference?: string | null };

export function recordOutcome(db: Database, id: string, body: OutcomeBody, ctx: Ctx): Check {
  const check = getCheck(db, id);
  assertNotArchived(check);
  if (!check.choice) throw new ServiceError(409, "STATE", "Record the route you used before recording an outcome.");
  if (check.status === "reconciled") {
    throw new ServiceError(409, "STATE", "This check is reconciled. Use “Correct amount” to add a correction.");
  }
  if (body.date > ymd(ctx.nowMs)) throw new ServiceError(422, "VALIDATION", "The date cannot be in the future.", { date: "The date cannot be in the future." });
  const prev = check.status;
  const next: CheckStatus = body.result === "received" ? "reconciled" : body.result;
  if (!canTransition(prev, next)) throw new ServiceError(409, "STATE", `An outcome of "${body.result}" cannot be recorded while the check is "${prev}".`);
  let level: Outcome["level"] = "modelled";
  let evidenceId: string | null = null;
  if (body.result === "received") {
    level = body.level;
    if (body.evidenceId) {
      const ev = check.evidence.find((e) => e.id === body.evidenceId);
      // Verified is set by the system only: a passed receipt check for exactly this amount.
      // A demo fixture can only ever give "demo_verified".
      if (ev && ev.result === "verified" && ev.file && dec(ev.file.amount).eq(dec(body.amount))) {
        level = ev.mode === "live" ? "verified" : "demo_verified";
        evidenceId = ev.id;
      }
    }
  }
  const outcome: Outcome = {
    id: nextId(db, "out"),
    at: iso(ctx.nowMs),
    by: ctx.actor,
    result: body.result,
    amount: body.result === "received" ? body.amount : null,
    currency: body.result === "received" ? check.choice.snapshot.currency : null,
    date: body.date,
    reportedBy: body.result === "received" ? body.reportedBy : null,
    reference: "reference" in body ? (body.reference ?? null) : null,
    level,
    evidenceId,
    correctionOf: null,
  };
  check.outcomes.push(outcome);
  transition(check, next);
  let msg: string;
  if (body.result === "received") {
    msg = `Outcome recorded: Received ${fmtMoney(body.amount, check.choice.snapshot.currency)}, reported by ${REPORTED_BY_LABEL[body.reportedBy].toLowerCase()}`;
    if (level === "verified") msg += "; verified by the system against the official receipt";
    if (level === "demo_verified") msg += "; matched a DEMO receipt file (not a real verification)";
    if (prev === "no_reply") msg += " (late reply)";
  } else if (body.result === "no_reply") {
    msg = "Outcome recorded: No reply. It still counts in the pilot results.";
  } else {
    msg = "Outcome recorded: Refused. The supplier declined to share the amount.";
  }
  addEvent(db, check, ctx.actor, "outcome_recorded", msg, ctx.nowMs);
  return check;
}

/** Corrections add a new outcome entry; the old one stays in the record. */
export function correctOutcome(db: Database, id: string, body: { amount: string }, ctx: Ctx): Check {
  const check = getCheck(db, id);
  assertNotArchived(check);
  const prev = currentOutcome(check);
  if (check.status !== "reconciled" || !prev || prev.result !== "received" || !prev.amount) throw new ServiceError(409, "STATE", "There is no received amount to correct.");
  if (dec(prev.amount).eq(dec(body.amount))) throw new ServiceError(422, "VALIDATION", "That is the amount already recorded.", { amount: "That is the amount already recorded." });
  check.outcomes.push({
    ...prev,
    id: nextId(db, "out"),
    at: iso(ctx.nowMs),
    by: ctx.actor,
    amount: body.amount,
    // A correction invalidates a verification made against the old amount.
    level: prev.level === "verified" || prev.level === "demo_verified" ? "reported" : prev.level,
    evidenceId: prev.level === "verified" || prev.level === "demo_verified" ? null : prev.evidenceId,
    correctionOf: prev.id,
  });
  const cur = check.choice!.snapshot.currency;
  addEvent(db, check, ctx.actor, "outcome_corrected", `Correction: received amount is ${fmtMoney(body.amount, cur)}, not ${fmtNum(prev.amount)}`, ctx.nowMs);
  return check;
}

export function recordPlanChange(db: Database, id: string, answer: PlanChange, ctx: Ctx): Check {
  const check = getCheck(db, id);
  assertNotArchived(check);
  if (check.outcomes.length === 0) throw new ServiceError(409, "STATE", "Record an outcome before saying whether it changed your plan.");
  check.planChanges.push({ at: iso(ctx.nowMs), by: ctx.actor, answer });
  addEvent(db, check, ctx.actor, "plan_change", `Plan change recorded: ${PLAN_CHANGE_LABEL[answer]}`, ctx.nowMs);
  return check;
}

/**
 * Record the result of a receipt verification (demo or live). The verifier runs BEFORE this, outside
 * the database transaction (it may call the network); this function only records what it found.
 * The beneficiary account is not a parameter here, so it cannot reach storage.
 */
export function recordReceiptCheck(
  db: Database,
  id: string,
  claim: Omit<ReceiptClaim, "beneficiaryAccount">,
  r: VerificationResult,
  ctx: Ctx,
): { check: Check; evidence: EvidenceRecord } {
  const check = getCheck(db, id);
  assertNotArchived(check);
  if (!check.choice) throw new ServiceError(409, "STATE", "Record the route you used first.");
  if (check.status === "refused") throw new ServiceError(409, "STATE", "The supplier refused to share the amount; there is nothing to verify.");
  if (r.mode === "demo" && !db.workspace.isDemo) throw new ServiceError(409, "DEMO_ONLY", "Demo receipt files can only be used in a demo workspace.");
  const evidence: EvidenceRecord = {
    id: nextId(db, "evd"),
    at: iso(ctx.nowMs),
    by: ctx.actor,
    kind: "cep",
    mode: r.mode,
    provider: r.provider,
    demo: r.demo,
    providerRef: r.providerRef,
    fileName: r.fileName,
    entered: {
      amount: claim.amount,
      date: claim.date,
      sendingBank: claim.sendingBank,
      receivingBank: claim.receivingBank,
      trackingKey: claim.trackingKey ?? null,
    },
    file: r.file ? { amount: r.file.amount, date: r.file.date, sendingBank: r.file.sendingBank, receivingBank: r.file.receivingBank } : null,
    result: r.result,
    detail: r.detail,
  };
  check.evidence.push(evidence);
  const label =
    r.result === "verified"
      ? "passed"
      : r.result === "mismatch"
        ? "amount does not match"
        : r.result === "invalid_account"
          ? "account invalid"
          : r.result === "not_found"
            ? "no receipt found"
            : "file unreadable";
  const source = r.mode === "demo" ? `DEMO file ${r.fileName}, not a real receipt` : `live check via ${r.provider}${r.providerRef ? `, ref ${r.providerRef}` : ""}`;
  addEvent(db, check, "system", "evidence_checked", `Receipt check (${source}): ${label}. ${r.detail}`, ctx.nowMs);

  // A passed check after reconciliation upgrades the CURRENT outcome by appending a new entry.
  // A demo pass never upgrades past "demo_verified", and never downgrades a live "verified".
  const level = r.mode === "live" ? "verified" : "demo_verified";
  const cur = currentOutcome(check);
  if (
    r.result === "verified" &&
    r.file &&
    cur &&
    cur.result === "received" &&
    cur.amount &&
    dec(cur.amount).eq(dec(r.file.amount)) &&
    cur.level !== "verified" &&
    cur.level !== level
  ) {
    check.outcomes.push({ ...cur, id: nextId(db, "out"), at: iso(ctx.nowMs), by: "system", level, evidenceId: evidence.id, correctionOf: cur.id });
    addEvent(
      db,
      check,
      "system",
      "outcome_corrected",
      level === "verified"
        ? "Evidence level set to Verified by the system. The beneficiary account was used for this check and not stored."
        : "Evidence level set to Verified (demo): a DEMO receipt file matched. No real payment record was checked.",
      ctx.nowMs,
    );
  }
  return { check, evidence };
}

/** Demo-only convenience (seed, tests): run the labelled demo fixture synchronously and record it. */
export function validateCep(
  db: Database,
  id: string,
  body: {
    demo: "match" | "mismatch" | "unreadable";
    amount: string;
    date: string;
    sendingBank: string;
    receivingBank: string;
    trackingKey?: string | null;
    beneficiaryAccount?: string | null;
  },
  ctx: Ctx,
): { check: Check; evidence: EvidenceRecord } {
  const { demo, beneficiaryAccount, ...rest } = body;
  const claim = { ...rest, trackingKey: rest.trackingKey ?? null };
  const result = demoVerify({ ...claim, beneficiaryAccount: beneficiaryAccount ?? null }, demo, getCheck(db, id).id);
  return recordReceiptCheck(db, id, claim, result, ctx);
}

export function addNote(db: Database, id: string, text: string, ctx: Ctx): Check {
  const check = getCheck(db, id);
  addEvent(db, check, ctx.actor, "note", text, ctx.nowMs);
  return check;
}

export function setArchived(db: Database, id: string, archived: boolean, ctx: Ctx): Check {
  const check = getCheck(db, id);
  if (check.archived === archived) return check;
  check.archived = archived;
  addEvent(db, check, ctx.actor, archived ? "archived" : "restored", archived ? "Archived. The record is kept." : "Restored from the archive.", ctx.nowMs);
  return check;
}

export function duplicateCheck(db: Database, id: string, ctx: Ctx): Check {
  const src = getCheck(db, id);
  const today = ymd(ctx.nowMs);
  const payBy = src.inputs.payBy < today ? addDays(today, 4) : src.inputs.payBy;
  const copy = createCheck(db, { ...structuredClone(src.inputs), payBy, supplierHash: src.supplierHash, draft: false, quote: null }, ctx);
  addEvent(db, copy, ctx.actor, "duplicated", `Duplicated from ${src.id}. Estimated afresh with the current rate and schedule.`, ctx.nowMs);
  addEvent(db, src, ctx.actor, "duplicated", `Duplicated as ${copy.id}.`, ctx.nowMs);
  return copy;
}

export function rateStatusFor(db: Database, check: Check, nowMs: number) {
  const est = latestEstimate(check);
  if (!est?.rate) return null;
  const f = rateFreshness(est.rate.retrievedAt, nowMs);
  const latest = currentRate(db);
  const latestFresh = latest ? rateFreshness(latest.retrievedAt, nowMs) : null;
  return { ...f, newerRateAvailable: !!latest && latest.id !== est.rate.id && !latestFresh?.stale };
}

export { estimateById };
