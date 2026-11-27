import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { readDb } from "@/server/db";
import { requirePageSession } from "@/server/auth/page";
import { shortSupplierId } from "@/lib/pseudonym";
import { checkDetail } from "@/server/views";
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtStamp } from "@/lib/format";
import { EVIDENCE_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id.toUpperCase()} report` };
}

/**
 * R1 one-page check report (wireframes "R1 report — peso invoice / dollar wire").
 * Light, printable; "Export PDF" prints this page. Uses the hashed supplier ID, never the nickname.
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePageSession(`/report/${id}`);
  const db = await readDb(session.scope);
  const check = db.checks.find((c) => c.id.toLowerCase() === id.toLowerCase());
  if (!check) notFound();
  const d = checkDetail(db, check, Date.now());
  const est = d.estimate;
  const i = d.inputs;
  const chosen = d.choice ? est?.options.find((o) => o.optionId === d.choice!.optionId) : null;
  const focus = chosen ?? est?.options.find((o) => o.optionId === est.focusOptionId) ?? null;
  const cur = focus?.destCurrency ?? i.invoiceCurrency;
  const quote = focus ? d.quotes.find((q) => q.ruleId === focus.ruleId && q.current) : null;

  return (
    <div className="min-h-screen bg-[#f4f4f5] py-8 text-[#18181b] print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[794px] items-center justify-between px-2 text-[13px] text-[#52525b]">
        <a href={`/checks/${check.id}`} className="hover:text-black">
          ← Back to {check.id}
        </a>
        <PrintButton />
      </div>
      <article className="mx-auto max-w-[794px] bg-white px-[56px] py-[48px] text-[14px] leading-relaxed shadow-[0_1px_3px_rgba(0,0,0,0.08)] print:max-w-none print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[#18181b] pb-3 text-[13px] text-[#52525b]">
          <span>
            Payment check {check.id} · Supplier #{shortSupplierId(check.supplierHash)}
          </span>
          <span>
            Prepared {fmtStamp(est?.computedAt ?? check.createdAt)} · {check.isDemo ? "Sample figures" : "Modelled figures"}
          </span>
        </header>

        {!est || !focus ? (
          <p className="mt-6">{d.calcError ? "The calculation failed for this check; no amounts are shown." : "This check has no eligible route or has not been compared yet."}</p>
        ) : (
          <>
            <p className="mt-4 text-[13px] text-[#52525b]">
              {fmtMoney(i.invoiceAmount, i.invoiceCurrency)} invoice · {est.mode === "cover" ? `${focus.label}` : `sending ${fmtMoney(focus.sendAmount, "USD")} by ${focus.label.split(",")[0]}`}
            </p>
            <h1 className="mt-1 text-[28px] font-[650] leading-tight tracking-[-0.02em]">
              {est.mode === "cover"
                ? `Will the full ${fmtMoney(i.invoiceAmount, i.invoiceCurrency)} arrive? ${focus.covers === "even_low" ? "Yes, even in the low case" : "Not for certain as planned"}`
                : `About ${fmtMoney(focus.typical, cur)} should arrive${focus.low ? `, at least ${fmtMoney(focus.low, cur)}` : ""}`}
            </h1>
            <p className="mt-2">
              {est.mode === "cover" ? `${focus.optionLabel ? `With ${focus.optionLabel}: ` : ""}about ${fmtMoney(focus.typical, cur)}, at least ${fmtMoney(focus.low, cur)}, high ${fmtMoney(focus.high, cur)}. ` : `High case ${fmtMoney(focus.high, cur)}. `}
              <b>Evidence: {EVIDENCE_LABEL[d.summary.evidence]}</b>
              {d.summary.evidence === "modelled" ? ", nothing observed yet" : ""}. Estimate, not a guarantee.
            </p>
            {Number(focus.shortfallTypical) > 0 && est.mode === "compare" && (
              <p className="mt-3 inline-block rounded-full border border-[#c2410c] px-3 py-0.5 font-[600] text-[#9a3412]">May arrive short by about {fmtMoney(focus.shortfallTypical, cur)}</p>
            )}
            {est.mode === "compare" && focus.coverSend.typical && focus.coverSend.low && focus.covers !== "even_low" && (
              <p className="mt-3">
                To cover the invoice, send about <b>{fmtMoney(focus.coverSend.typical, "USD", 2)}</b> (typical case) or <b>{fmtMoney(focus.coverSend.low, "USD", 2)}</b> (even the low case).
              </p>
            )}
            {est.mode === "cover" && est.verdict.kind === "cover" && est.verdict.topUpOptionId && (
              <div className="mt-4 rounded-[10px] border border-[#18181b] px-4 py-3">
                <b>{est.verdictText.body}</b>
              </div>
            )}

            <h2 className="mt-6 font-[650]">{est.mode === "cover" ? "USD received, by charge code" : `Routes, ${cur} received`}</h2>
            <table className="mt-1 w-full text-[14px]">
              <thead>
                <tr className="border-b border-[#18181b] text-left">
                  <th className="py-1.5 font-[650]">{est.mode === "cover" ? "Option" : "Route"}</th>
                  <th className="py-1.5 text-right font-[650]">Low</th>
                  <th className="py-1.5 text-right font-[650]">Typical</th>
                  <th className="py-1.5 text-right font-[650]">High</th>
                  {est.mode === "compare" && <th className="py-1.5 text-right font-[650]">Provider quote</th>}
                  <th className="py-1.5 text-right font-[650]">You pay USD</th>
                  {est.mode === "cover" && <th className="py-1.5 pl-4 text-left font-[650]">Covers invoice?</th>}
                </tr>
              </thead>
              <tbody className="tnum">
                {est.options.map((o) => (
                  <tr key={o.optionId} className="border-b border-[#e4e4e7]">
                    <td className="py-1.5">{o.optionLabel ? `${o.optionLabel}, send ${fmtNum(o.sendAmount)}` : `${o.label.split(",")[0]}, ${o.speedLabel}`}</td>
                    <td className="py-1.5 text-right">{o.low ? fmtNum(o.low) : "unknown"}</td>
                    <td className="py-1.5 text-right">{fmtNum(o.typical)}</td>
                    <td className="py-1.5 text-right">{fmtNum(o.high)}</td>
                    {est.mode === "compare" && <td className="py-1.5 text-right">{o.quoteReceipt ? fmtNum(o.quoteReceipt) : "not given"}</td>}
                    <td className="py-1.5 text-right">{o.youPay ? fmtNum(o.youPay) : "unknown"}</td>
                    {est.mode === "cover" && <td className="py-1.5 pl-4">{o.covers === "even_low" ? "Yes, even low" : o.covers === "typical" ? "May arrive short" : o.covers === "short_all" ? "Short" : "May arrive short"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[13px] text-[#52525b]">
              All route figures are modelled.
              {quote && quote.analysis ? ` ${quote.routeLabel.split(",")[0]} quote: ${quote.sentence}` : est.mode === "cover" ? " SHA: charges shared. OUR: you pay all charges, though the receiving bank may still charge. BEN: supplier pays all charges. No provider quote was given." : ""}
              {est.excluded.length > 0 && ` Excluded: ${est.excluded.map((x) => `${x.label}, because ${x.reason}`).join("; ")}.`}
            </p>

            <h2 className="mt-6 font-[650]">Where the {focus.label.split(",")[0]} typical figure comes from</h2>
            <table className="mt-1 w-full text-[14px]">
              <thead>
                <tr className="border-b border-[#18181b] text-left">
                  <th className="py-1.5 font-[650]">Item</th>
                  <th className="py-1.5 text-right font-[650]">Amount</th>
                  <th className="py-1.5 pl-6 font-[650]">Source</th>
                  <th className="py-1.5 font-[650]">Timestamp</th>
                  <th className="py-1.5 font-[650]">Evidence</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {focus.cases.typical.lines
                  .filter((l) => l.key !== "result" && l.key !== "principal")
                  .map((l) => (
                    <tr key={l.key} className="border-b border-[#e4e4e7]">
                      <td className="py-1.5">{l.key === "conversion" ? `${fmtMoney(focus.sendAmount, "USD")} less deductions, at ${est.rate?.rate}` : l.label}</td>
                      <td className="py-1.5 text-right">{fmtMoney(l.amount, l.currency, l.key === "sender_fee" ? 2 : 0)}</td>
                      <td className="py-1.5 pl-6">{l.source}</td>
                      <td className="py-1.5">{l.timestamp ? fmtStamp(l.timestamp) : ""}</td>
                      <td className="py-1.5">{SOURCE_LABEL[l.classification]}</td>
                    </tr>
                  ))}
                {quote && (
                  <tr className="border-b border-[#e4e4e7]">
                    <td className="py-1.5">Provider quote</td>
                    <td className="py-1.5 text-right">{fmtMoney(quote.quotedReceipt, quote.currency)}</td>
                    <td className="py-1.5 pl-6">Customer</td>
                    <td className="py-1.5">{fmtStamp(quote.at)}</td>
                    <td className="py-1.5">As quoted</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-2 text-[13px] text-[#52525b]">
              Low case {focus.low ? fmtNum(focus.low) : "unknown"} uses {fmtPct(focus.cases.low.markupPct)} markup; high case {fmtNum(focus.high)} uses {fmtPct(focus.cases.high.markupPct)}.
            </p>

            {d.reconciliation ? (
              <div className="mt-6 rounded-[10px] border border-[#18181b] px-5 py-4">
                <b>Outcome</b>
                <p className="mt-1">{d.reconciliation.sentence}</p>
                <p className="mt-1 text-[13px]">
                  Our error (actual − estimate) {fmtNum(d.reconciliation.ourError)} · quote error (quote − actual) {d.reconciliation.quoteError ? fmtNum(d.reconciliation.quoteError) : "none given"} · received {fmtDate(d.reconciliation.date)}
                </p>
              </div>
            ) : (
              <div className="mt-6 rounded-[10px] border border-[#18181b] px-5 py-4 leading-loose">
                <b>Please send this back after you pay</b>
                {est.mode === "cover" && <div>Charge code used: ☐ SHA ☐ OUR ☐ BEN</div>}
                <div>Outcome: ☐ Received ☐ No reply ☐ Refused</div>
                <div>
                  Amount {cur} ______________ Date ____________ Reported by ☐ Supplier ☐ Us
                </div>
                <div>Attached: ☐ {est.mode === "cover" ? "Supplier's bank credit advice" : "Bank record or SPEI receipt (CEP)"} ☐ Tax record (payment complement)</div>
                <div>
                  <b>Did this change your plan?</b> ☐ Route ☐ Amount ☐ Timing ☐ Nothing
                </div>
              </div>
            )}
          </>
        )}
        <footer className="mt-10 border-t border-[#e4e4e7] pt-3 text-[13px] text-[#52525b]">
          Low, typical and high are modelled scenarios, not measured probabilities. We never move money; you pay in your own bank or provider. No route pays to be ranked higher. Calculation {est?.calcVersion ?? "v0.3"}, fee schedule v{est?.scheduleVersion ?? "—"}.
          {check.isDemo && " Demo workspace: all figures are illustrative."}
        </footer>
      </article>
    </div>
  );
}
