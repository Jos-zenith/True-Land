import { route, parseBody } from "@/server/http";
import { readDb } from "@/server/db";
import { buildEstimate, currentRate, currentSchedule } from "@/server/core";
import { checkInputsSchema, previewSchema, zodFieldErrors } from "@/lib/schemas";
import { EngineError, dec } from "@/engine";
import { ymd } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Composer preview: conversion at the sample rate and which routes are unavailable. Nothing is saved. */
export const POST = route("read", async ({ req, auth, nowMs }) => {
  const raw = await parseBody(req, previewSchema);
  const db = await readDb(auth.scope); // a private copy: nothing here is persisted
  const rate = currentRate(db);
  const sched = currentSchedule(db);
  const empty = { rate, scheduleVersion: sched.version, excluded: [], eligible: [], grossAtMid: null, verdictKind: null };
  let suggestedSend: string | null = null;
  if (raw.invoiceAmount && rate && raw.invoiceCurrency === "MXN") {
    const n = raw.invoiceAmount.replace(/[,\s]/g, "");
    if (/^\d+(\.\d+)?$/.test(n) && Number(n) > 0) suggestedSend = dec(n).div(dec(rate.rate)).toDecimalPlaces(2).toFixed();
  }
  const full = checkInputsSchema.safeParse(raw);
  if (!full.success) return { ...empty, ok: false, fields: zodFieldErrors(full.error), suggestedSend };
  if (full.data.payBy < ymd(nowMs)) return { ...empty, ok: false, fields: { payBy: "Choose today or a later date." }, suggestedSend };
  try {
    const est = buildEstimate(db, full.data, nowMs);
    return {
      ok: true,
      fields: {},
      rate,
      scheduleVersion: sched.version,
      suggestedSend,
      grossAtMid: est.result.grossAtMid,
      excluded: est.result.excluded,
      eligible: est.result.options
        .filter((o) => !o.isTopUp)
        .map((o) => ({ ruleId: o.ruleId, label: o.optionLabel ? `${o.label} (${o.optionLabel})` : o.label })),
      verdictKind: est.result.verdict.kind,
    };
  } catch (e) {
    if (e instanceof EngineError) return { ...empty, ok: false, fields: { _form: e.message }, suggestedSend };
    throw e;
  }
});
