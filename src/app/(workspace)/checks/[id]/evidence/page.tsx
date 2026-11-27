"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { clsx } from "clsx";
import { ArrowRight, Check, X } from "lucide-react";
import { useCheck } from "@/components/checks/check-context";
import { SourceBadge } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/field";
import { SectionTitle } from "@/components/ui/layout";
import { Notice } from "@/components/ui/feedback";
import { fmtAgo, fmtDate, fmtMoney, fmtNum, fmtPct, fmtRate, fmtStamp } from "@/lib/format";
import { EVIDENCE_LABEL, PAYOUT_LABEL } from "@/lib/labels";
import type { BreakdownLine, Case } from "@/engine/types";

const PAYER: Record<BreakdownLine["payer"], string> = {
  you: "You",
  from_principal: "From principal",
  from_receipt: "From receipt",
  on_top: "You, on top",
  none: "",
};
const STAGE: Record<BreakdownLine["stage"], string> = {
  sending: "Sending",
  intermediary: "Intermediary bank",
  conversion: "Conversion",
  receiving: "Receiving bank",
  result: "Result",
};

export default function EvidencePage() {
  return (
    <Suspense>
      <Evidence />
    </Suspense>
  );
}

function Evidence() {
  const { detail: d, focusId, setFocusId, id } = useCheck();
  const params = useSearchParams();
  const est = d.estimate;
  const [c, setC] = useState<Case>("typical");
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);
  useEffect(() => {
    const o = params.get("option");
    if (o) setFocusId(o);
  }, [params, setFocusId]);

  if (!est || est.options.length === 0) {
    return (
      <div className="mx-auto max-w-[760px]">
        <h1 className="text-[20px] font-[590] text-figure">Evidence</h1>
        <p className="mt-2 text-[13px] text-meta">
          {d.calcError ? "The calculation failed, so there is nothing to show. Inputs are saved." : d.summary.status === "draft" ? "This draft has not been compared yet." : "No route is eligible, so no estimate was built."}
        </p>
        {est?.excluded.length ? <ExcludedList /> : null}
      </div>
    );
  }

  const o = est.options.find((x) => x.optionId === focusId) ?? est.options[0];
  const lines = o.cases[c].lines;
  const main = lines.filter((l) => l.key !== "sender_fee");
  const sender = lines.find((l) => l.key === "sender_fee")!;
  const rule = o.rule;
  const conv = o.sourceCurrency !== o.destCurrency;
  const quote = d.quotes.find((q) => q.ruleId === o.ruleId && q.current);
  const otherCases = (["low", "typical", "high"] as Case[]).filter((x) => x !== c);
  const describe = (k: Case) =>
    conv
      ? `${fmtPct(o.cases[k].markupPct)} markup and ${fmtMoney(o.cases[k].deduction, o.sourceCurrency)} deductions`
      : `${fmtMoney(o.cases[k].deduction, o.sourceCurrency)} deductions`;
  const value = (k: Case) => (k === "low" && o.low === null ? "unknown" : fmtNum(o.cases[k].receipt));

  return (
    <div className="mx-auto max-w-[880px]">
      <h1 className="text-[20px] font-[590] tracking-[-0.015em] text-figure">
        How {o.rough && "at most "}
        {fmtMoney(o.cases[c].receipt, o.destCurrency)} is built
      </h1>
      <p className="mt-1 text-[13px] text-meta">
        {o.displayLabel} · {c} case · sending {fmtMoney(o.sendAmount, o.sourceCurrency, 2)} · computed {fmtStamp(est.computedAt)} with calc {est.calcVersion} and fee schedule v{est.scheduleVersion}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {est.options.length > 1 && (
          <Segmented
            label="Route"
            size="sm"
            value={o.optionId}
            onChange={setFocusId}
            options={est.options.map((x) => ({ value: x.optionId, label: x.optionLabel ? `${x.optionLabel}${x.isTopUp ? " top-up" : ""}` : x.label.split(",")[0] }))}
          />
        )}
        <Segmented label="Case" size="sm" value={c} onChange={setC} options={[{ value: "low", label: "Low" }, { value: "typical", label: "Typical" }, { value: "high", label: "High" }]} />
      </div>

      {o.rough && (
        <Notice tone="warn" className="mt-4" title="Rough estimate">
          {o.missing.join(" and ")} {o.missing.length > 1 ? "are" : "is"} not known for this route, so {o.missing.length > 1 ? "they are" : "it is"} treated as 0. The figures are an upper bound: the supplier may receive less. This route is never ranked against complete estimates.
        </Notice>
      )}

      <div className="mt-4 overflow-x-auto rounded-[9px] border border-hairline">
        <table className="w-full min-w-[680px] text-[13px]">
          <caption className="sr-only">Calculation of the {c} case for {o.displayLabel}</caption>
          <thead>
            <tr className="border-b border-hairline text-left text-meta">
              <th scope="col" className="px-4 py-2.5 font-[510]">Component</th>
              <th scope="col" className="px-3 py-2.5 font-[510]">Who pays</th>
              <th scope="col" className="px-3 py-2.5 text-right font-[510]">Amount</th>
              <th scope="col" className="px-3 py-2.5 text-right font-[510]">Running</th>
              <th scope="col" className="px-3 py-2.5 font-[510]">Source</th>
              <th scope="col" className="px-4 py-2.5 font-[510]">Evidence</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {main.map((l) => {
              const result = l.key === "result";
              return (
                <tr key={l.key} className={clsx("border-b border-hairline align-top", result && "bg-group/70")}>
                  <th scope="row" className={clsx("px-4 py-2.5 text-left font-[510]", result ? "text-figure" : "text-label")}>
                    {result ? `Expected, ${c}` : l.key === "principal" ? `${fmtMoney(l.amount, l.currency)} sent` : l.label}
                    {!result && <div className="text-xs font-normal text-meta">{STAGE[l.stage]}</div>}
                    {l.note && <div className="mt-0.5 text-xs font-normal text-warn">{l.note}</div>}
                  </th>
                  <td className="whitespace-nowrap px-3 py-2.5 text-label">{PAYER[l.payer]}</td>
                  <td className={clsx("whitespace-nowrap px-3 py-2.5 text-right", result ? "font-[590] text-figure" : "text-label")}>
                    {l.key === "conversion" ? fmtMoney(l.amount, l.currency) : l.key === "principal" ? fmtMoney(l.amount, l.currency, 2) : fmtMoney(l.amount, l.currency, Number(l.amount) % 1 ? 2 : 0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-meta">{l.balance && !result ? fmtMoney(l.balance, l.balanceCurrency!, 2) : ""}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-label">
                    {l.source}
                    {l.timestamp && (
                      <div className="text-xs text-meta">
                        {fmtStamp(l.timestamp)}
                        {now ? ` · ${fmtAgo(l.timestamp, now)} old` : ""}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <SourceBadge cls={l.classification} demo={l.key === "conversion" && est.rate?.isDemo} />
                  </td>
                </tr>
              );
            })}
            <tr className="align-top text-meta">
              <th scope="row" className="px-4 py-2.5 text-left font-[510]">
                Sending fee, paid on top
                <div className="text-xs font-normal">Sending · not deducted from the receipt</div>
              </th>
              <td className="whitespace-nowrap px-3 py-2.5">You</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right">{sender.known ? fmtMoney(sender.amount, sender.currency, 2) : "unknown"}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right">{o.youPay ? `you pay ${fmtNum(o.youPay, 2)}` : ""}</td>
              <td className="whitespace-nowrap px-3 py-2.5">
                {sender.source}
                {sender.timestamp && <div className="text-xs">{fmtStamp(sender.timestamp)}{now ? ` · ${fmtAgo(sender.timestamp, now)} old` : ""}</div>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5">
                <SourceBadge cls={sender.classification} />
              </td>
            </tr>
            {quote && (
              <tr className="border-t border-hairline align-top">
                <th scope="row" className="px-4 py-2.5 text-left font-[510] text-label">
                  Provider quote
                  <div className="text-xs font-normal text-meta">Before paying · not used in the estimate</div>
                </th>
                <td className="px-3 py-2.5 text-label" />
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-label">{fmtMoney(quote.quotedReceipt, quote.currency)}</td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-label">
                  Customer, {quote.byName}
                  <div className="text-xs text-meta">{fmtStamp(quote.at)}{now ? ` · ${fmtAgo(quote.at, now)} old` : ""}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <SourceBadge cls="provider_quote" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[13px] text-meta">
        {otherCases.map((k, i) => (
          <span key={k}>
            {i > 0 && " "}
            {k[0].toUpperCase() + k.slice(1)} case {value(k)} uses {describe(k)}.
          </span>
        ))}{" "}
        Low, typical and high are configured scenarios, not measured probabilities.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="rounded-[9px] border border-hairline px-5 py-4" aria-label="Eligibility">
          <h2 className="text-[13px] font-[590] text-figure">Eligibility</h2>
          <ul className="mt-2.5 flex flex-col gap-1.5 text-[13px] text-label">
            <Ok>Supplier receives {PAYOUT_LABEL[d.inputs.payoutMethod as keyof typeof PAYOUT_LABEL].toLowerCase()}</Ok>
            <Ok>You hold an account with {o.label.split(",")[0].replace(/ USD wire$/, "")}</Ok>
            <Ok>
              Arrives before {fmtDate(d.inputs.payBy)} ({o.speedLabel})
            </Ok>
            <Ok>Amount within the route&apos;s limits</Ok>
            <Ok>{rule.eligibilityNote}</Ok>
          </ul>
        </section>
        <section className="rounded-[9px] border border-hairline px-5 py-4" aria-label="Explanation">
          <h2 className="text-[13px] font-[590] text-figure">Explanation</h2>
          <p className="mt-2.5 text-[13px] leading-relaxed text-meta">
            {conv ? (
              Number(o.cases[c].deduction) === 0 ? (
                <>The shortfall against the mid-market value comes from the exchange-rate markup. No intermediary deductions are assumed for a local peso payout.</>
              ) : (
                <>Intermediary banks may take {fmtMoney(o.cases[c].deduction, o.sourceCurrency)} from the principal before conversion; the bank then converts at a markup of {fmtPct(o.cases[c].markupPct)} over mid-market.</>
              )
            ) : (
              <>No conversion: the wire is sent and received in dollars. Intermediary or receiving banks may deduct {fmtMoney(o.cases[c].deduction, o.sourceCurrency)} depending on the charge code.</>
            )}{" "}
            The sending fee is added to what you pay and never subtracted from what arrives. Written from fixed templates; no generated figures.
          </p>
        </section>
      </div>

      <section className="mt-6" aria-label="Assumptions">
        <SectionTitle>Assumptions used</SectionTitle>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-meta marker:text-deco">
          {conv && est.rate && !est.rate.benchmarkId && (
            <li>
              Benchmark: {fmtRate(est.rate.rate)} MXN per USD, {est.rate.source.toLowerCase()} ({est.rate.isDemo ? "illustrative demo value, not a market quote" : "manually entered"}), retrieved {fmtStamp(est.rate.retrievedAt)}
              {est.rateStale && <span className="text-warn">, now stale</span>}.
            </li>
          )}
          {conv && est.rate?.benchmarkId && (
            <li>
              Benchmark: reference FX rate {fmtRate(est.rate.rate)} MXN per USD from {est.rate.benchmarkProvider === "currencyapi" ? "currencyapi.com" : "Frankfurter"}, observed by the source{" "}
              {est.rate.observedAt ? fmtStamp(est.rate.observedAt) : "at an unknown time"}, adopted {fmtStamp(est.rate.retrievedAt)}
              {est.rateStale && <span className="text-warn"> (now stale)</span>}. Benchmark snapshot {est.rate.benchmarkId}, selection policy {est.rate.benchmarkPolicy}. A reference rate is not a provider&apos;s offered rate; the route&apos;s markup models the difference.
            </li>
          )}
          <li>
            Fees, markups and deductions come from {rule.source}, last verified {fmtStamp(rule.lastVerifiedAt)}. They are {EVIDENCE_LABEL.modelled.toLowerCase()} assumptions, not observed charges.
          </li>
          <li>Fee payer on this route: {rule.feePayer === "shared" ? "shared (SHA): you pay the sending fee, deductions come from the principal" : rule.feePayer === "sender" ? "you pay the costs you can see; the markup is inside the rate" : "the supplier (BEN): all charges come out of the principal"}.</li>
          <li>Rounding happens only for display: receipts to whole units, amounts you send to the cent, rates to four decimals.</li>
          <li>The estimate is frozen in this check. Later rates or schedules add a new estimate; they never change this one.</li>
        </ul>
        <Link href="/methodology" className="mt-3 inline-flex items-center gap-1 text-[13px] font-[510] text-accent-hover hover:text-[#9aa4ff]">
          Read the methodology <ArrowRight size={13} />
        </Link>
      </section>

      {est.excluded.length > 0 && <ExcludedList />}
      <p className="mt-8 text-xs text-meta">
        Evidence for <Link className="text-label hover:text-figure" href={`/checks/${id}/compare`}>{id}</Link>. Estimates are not guarantees. Landed never moves money.
      </p>
    </div>
  );
}

function Ok({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check size={14} className="mt-[3px] shrink-0 text-ok" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

function ExcludedList() {
  const { detail: d } = useCheck();
  return (
    <section className="mt-6" aria-label="Excluded routes">
      <SectionTitle>Excluded routes</SectionTitle>
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {d.estimate!.excluded.map((x) => (
          <li key={x.ruleId} className="flex items-start gap-2 text-label">
            <X size={14} className="mt-[3px] shrink-0 text-meta" aria-hidden />
            <span>
              {x.label}: <span className="text-meta">{x.reason}. Not ranked; no figures shown.</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
