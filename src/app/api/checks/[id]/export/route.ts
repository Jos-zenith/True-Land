import { NextResponse } from "next/server";
import { readDb, mutate } from "@/server/db";
import { addEvent, getCheck } from "@/server/core";
import { checkDetail } from "@/server/views";
import { route } from "@/server/http";
import { EVIDENCE_LABEL, SOURCE_LABEL, STATUS_LABEL } from "@/lib/labels";
import { csvRow } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * CSV export of one check. Figures are exported at full precision; nothing is recalculated.
 * The supplier nickname is never sent to the server: the browser adds it to the file locally.
 */
export const GET = route<{ id: string }>("check:export", async ({ req, params, auth, nowMs }) => {
  {
    const { id } = params;
    const url = new URL(req.url);
    const include = new Set((url.searchParams.get("include") ?? "inputs,evidence,quote").split(","));
    const db = await readDb(auth.scope);
    const check = getCheck(db, id);
    const v = checkDetail(db, check, nowMs);
    const rows: unknown[][] = [["section", "field", "value", "currency", "source", "classification", "timestamp"]];
    rows.push(["check", "id", check.id]);
    rows.push(["check", "supplier_id", `#${check.supplierHash}`]);
    rows.push(["check", "status", STATUS_LABEL[check.status]]);
    rows.push(["check", "evidence_level", EVIDENCE_LABEL[v.summary.evidence]]);
    rows.push(["check", "demo_data", check.isDemo ? "yes (illustrative)" : "no"]);
    if (include.has("inputs")) {
      const i = check.inputs;
      rows.push(["inputs", "invoice_amount", i.invoiceAmount, i.invoiceCurrency]);
      rows.push(["inputs", "send_amount", i.sendAmount, "USD"]);
      rows.push(["inputs", "pay_by", i.payBy]);
      rows.push(["inputs", "payout_method", i.payoutMethod]);
      rows.push(["inputs", "providers", i.providers.join(" ")]);
      if (v.estimate) {
        const e = v.estimate;
        rows.push(["estimate", "computed_at", e.computedAt]);
        rows.push(["estimate", "calc_version", e.calcVersion]);
        rows.push(["estimate", "fee_schedule", `v${e.scheduleVersion}`]);
        if (e.rate) rows.push(["estimate", "rate", e.rate.rate, `${e.rate.base}/${e.rate.quote}`, e.rate.source, SOURCE_LABEL[e.rate.classification], e.rate.retrievedAt]);
        for (const o of e.options) {
          const name = o.displayLabel;
          rows.push(["route", `${name} low`, o.low ?? "unknown", o.destCurrency, o.rule.source, "Modelled"]);
          rows.push(["route", `${name} typical`, o.typical, o.destCurrency, o.rule.source, "Modelled"]);
          rows.push(["route", `${name} high`, o.high, o.destCurrency, o.rule.source, "Modelled"]);
          rows.push(["route", `${name} you pay`, o.youPay ?? "unknown", o.sourceCurrency]);
        }
        for (const x of e.excluded) rows.push(["excluded", x.label, x.reason]);
      }
    }
    if (include.has("evidence") && v.estimate) {
      for (const o of v.estimate.options) {
        for (const l of o.cases.typical.lines) {
          rows.push(["evidence", `${o.displayLabel}: ${l.label}`, l.amount, l.currency, l.source, SOURCE_LABEL[l.classification], l.timestamp ?? ""]);
        }
      }
    }
    if (include.has("quote")) {
      for (const q of v.quotes) rows.push(["quote", q.routeLabel, q.quotedReceipt, q.currency, "Customer", "Provider quote", q.at]);
      if (v.choice) rows.push(["choice", "route", v.choice.displayLabel, "", "", "", v.choice.at]);
      if (v.outcome) rows.push(["outcome", v.outcome.result, v.outcome.amount ?? "", v.outcome.currency ?? "", v.outcome.reportedBy ?? "", EVIDENCE_LABEL[v.outcome.level], v.outcome.at]);
      if (v.reconciliation) {
        rows.push(["reconciliation", "our_error (actual - estimate)", v.reconciliation.ourError, v.reconciliation.currency]);
        rows.push(["reconciliation", "quote_error (quote - actual)", v.reconciliation.quoteError ?? "none given", v.reconciliation.currency]);
        rows.push(["reconciliation", "inside_range", v.reconciliation.insideRange === null ? "unknown" : v.reconciliation.insideRange ? "yes" : "no"]);
      }
    }
    rows.push(["notice", "disclaimer", "Estimates are modelled scenarios, not guarantees or measured probabilities. Landed never moves money."]);
    const csv = rows.map(csvRow).join("\r\n");
    await mutate(auth.scope, (d) => addEvent(d, getCheck(d, id), d.currentUserId, "export", "Exported CSV", nowMs));
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${check.id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
});
