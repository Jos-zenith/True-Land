"use client";

import Link from "next/link";
import { useState } from "react";
import { clsx } from "clsx";
import { ArrowRight, ChevronRight, RotateCw } from "lucide-react";
import { useCheck, type OptionView } from "@/components/checks/check-context";
import { RangeBar, sharedScale } from "@/components/finance/range-bar";
import { StatCell, StatGrid } from "@/components/finance/money";
import { ActivityList } from "@/components/finance/activity";
import { NoteBox } from "@/components/checks/note-box";
import { PlainChip, SourceBadge } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { SectionTitle } from "@/components/ui/layout";
import { Tip } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError } from "@/hooks/use-api";
import { fmtAgeHours, fmtDate, fmtMoney, fmtNum, fmtPct, fmtStamp } from "@/lib/format";
import { PAYOUT_LABEL } from "@/lib/labels";
import { providerNames } from "@/components/checks/util";
import { WiseQuotePanel } from "@/components/checks/wise-quote-panel";

export default function ComparePage() {
  const { detail: d, nickname, focus, focusId, setFocusId, id, updateRate } = useCheck();
  const est = d.estimate;
  const inv = d.inputs;

  if (d.summary.status === "draft") return <DraftState />;
  if (d.calcError && !est) return <CalcErrorState />;
  if (!est) return null;

  const cur = inv.invoiceCurrency;
  const title =
    est.mode === "cover"
      ? `${nickname}: will the full ${fmtMoney(inv.invoiceAmount, cur)} arrive?`
      : `${nickname}, ${fmtMoney(inv.invoiceAmount, cur)} invoice paid in USD`;
  const v = est.verdict;
  const noRank = v.kind === "too_close" || v.kind === "unrankable";
  const scale = sharedScale([...est.options.flatMap((o) => [o.low ?? o.typical, o.high]), cur === est.options[0]?.destCurrency ? inv.invoiceAmount : null]);
  const invoiceInDest = est.options[0] && cur === est.options[0].destCurrency ? inv.invoiceAmount : null;

  return (
    <div className="mx-auto max-w-[760px]">
      <h1 className="text-[20px] font-[590] leading-snug tracking-[-0.015em] text-figure">{title}</h1>
      {focus ? (
        <>
          <p className="mt-1.5 text-[13px] font-[590] text-figure">
            {noRank && <span className="font-[510] text-meta">{focus.label}: </span>}
            {focus.lead}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-meta">{focus.sub}</p>
        </>
      ) : (
        <p className="mt-1.5 text-[13px] text-meta">{est.verdictText.body}</p>
      )}

      {est.rateStale && (
        <Notice
          tone="warn"
          className="mt-4"
          title={`Rate is ${Math.floor(est.rateAgeHours ?? 0)} hours old`}
          action={
            d.actions.canRecalculate && (
              <Button size="sm" onClick={updateRate} icon={<RotateCw size={12} />}>
                Update rate
              </Button>
            )
          }
        >
          Amounts are labelled stale; recording a choice asks for confirmation. Updating adds a new estimate and keeps this one.
        </Notice>
      )}
      {!est.rateStale && est.rateWarn && (
        <Notice tone="warn" className="mt-4" title="Rate turns 24 hours old soon">
          Record a choice before then, or update the rate.
        </Notice>
      )}
      {est.isChosenSnapshot && (
        <Notice className="mt-4" title="Frozen at the time of the choice">
          This is the estimate saved when {d.choice?.displayLabel} was chosen on {fmtStamp(d.choice?.at)}. It is never recalculated with later rates or schedules.
        </Notice>
      )}

      {focus && (
        <div className="mt-5">
          <StatGrid>
            <StatCell label="Expected, typical" value={fmtMoney(focus.typical, focus.destCurrency)} />
            <StatCell label="At least, low case" value={focus.low ? fmtMoney(focus.low, focus.destCurrency) : "Unknown"} muted={!focus.low} />
            <StatCell label="High case" value={fmtMoney(focus.high, focus.destCurrency)} />
            <StatCell label="Invoice" value={fmtMoney(inv.invoiceAmount, cur)} muted />
          </StatGrid>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {focus.covers !== "even_low" ? (
              <PlainChip tone="short" glyph="dot">
                {focus.covers === "short_all" ? "Short in every case" : focus.covers === "unknown" ? "Cover unknown" : "May arrive short"}
              </PlainChip>
            ) : (
              <PlainChip tone="ok" glyph="dot">
                Even the low case covers the invoice
              </PlainChip>
            )}
            <PlainChip glyph="ring">{focus.rough ? "Rough: a cost is unknown" : "Modelled, nothing observed yet"}</PlainChip>
            <PlainChip>Estimate, not a guarantee</PlainChip>
            {est.rateStale && (
              <PlainChip tone="warn" glyph="dot">
                Stale rate
              </PlainChip>
            )}
            <span className="tnum ml-1 text-xs text-meta">Computed {fmtStamp(est.computedAt)}</span>
          </div>
        </div>
      )}

      <VerdictLine />

      <section className="mt-6" aria-label="Routes">
        <SectionTitle
          aside={
            <span className="tnum">
              Scale {fmtNum(scale.min)} to {fmtNum(scale.max)} {est.options[0]?.destCurrency}
              {invoiceInDest && " · dashed line = invoice"}
            </span>
          }
        >
          {est.mode === "cover" ? `${est.options[0]?.label ?? "Routes"}, by charge code` : "Routes"} <span className="tnum font-[510] text-meta">{est.options.length}</span>
        </SectionTitle>
        {est.options.length === 0 ? (
          <div className="rounded-[9px] border border-hairline px-5 py-6">
            <div className="text-[14px] font-[590] text-figure">{est.verdictText.title}</div>
            <p className="mt-1 text-[13px] text-meta">{est.verdictText.body}</p>
            {d.actions.canEditInputs && <EditHint />}
          </div>
        ) : (
          <div role="radiogroup" aria-label="Choose a route to inspect" className="overflow-hidden rounded-[9px] border border-hairline">
            {est.options.map((o, i) => (
              <RouteRow key={o.optionId} o={o} first={i === 0} focused={o.optionId === focusId} onFocus={() => setFocusId(o.optionId)} scale={scale} invoice={invoiceInDest} rateAge={est.rateAgeHours} noRank={noRank} />
            ))}
          </div>
        )}
        {est.mode === "cover" && est.options.length > 0 && (
          <p className="mt-3 text-[13px] leading-relaxed text-meta">
            Charge assumptions are sample values for the deduction (low / typical / high result):{" "}
            {est.options
              .filter((o) => !o.isTopUp)
              .map((o) => `${o.optionLabel} ${fmtNum(o.cases.low.deduction)} / ${fmtNum(o.cases.typical.deduction)} / ${fmtNum(o.cases.high.deduction)}`)
              .join(", ")}
            . Sender wire fees are paid on top. Whether a bank honours the code must be checked.
          </p>
        )}
        {est.excluded.length > 0 && (
          <details className="group mt-3 text-[13px] text-meta">
            <summary className="flex cursor-default list-none items-center gap-1 rounded-[5px] hover:text-label [&::-webkit-details-marker]:hidden">
              <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
              {est.excluded.length} excluded route{est.excluded.length > 1 ? "s" : ""}: {est.excluded.map((x) => x.label).join(", ")}
            </summary>
            <ul className="mt-2 flex flex-col gap-1 pl-[18px]">
              {est.excluded.map((x) => (
                <li key={x.ruleId}>
                  <span className="text-label">{x.label}</span>: {x.reason}. Not ranked and no figures shown.
                </li>
              ))}
            </ul>
          </details>
        )}
        {focus && (
          <Link href={`/checks/${id}/evidence?option=${encodeURIComponent(focus.optionId)}`} className="mt-4 inline-flex items-center gap-1 text-[13px] font-[510] text-accent-hover hover:text-[#9aa4ff]">
            How {fmtMoney(focus.typical, focus.destCurrency)} is built, source by source <ArrowRight size={13} />
          </Link>
        )}
      </section>

      {est.options.length > 0 && <CostTable />}

      {inv.payoutMethod === "spei_mxn" && <WiseQuotePanel checkId={id} canRequest={d.actions.canAddQuote} />}

      {d.estimateHistory.length > 1 && (
        <section className="mt-8" aria-label="Estimate history">
          <SectionTitle aside="Snapshots are immutable">Estimate history</SectionTitle>
          <ol className="flex flex-col gap-1 text-[13px] text-meta">
            {[...d.estimateHistory].reverse().map((h, i) => (
              <li key={h.id} className="tnum">
                <span className={clsx(h.isShown ? "text-label" : "")}>{fmtStamp(h.computedAt)}</span> · calc {h.calcVersion} · schedule v{h.scheduleVersion}
                {h.rate && ` · rate ${h.rate}`}
                {h.isShown ? " · shown above" : i === 0 ? "" : " · kept"}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mt-8 border-t border-hairline pt-6" aria-label="Activity">
        <SectionTitle>Activity</SectionTitle>
        <ActivityList events={d.events} />
        <NoteBox />
      </section>
    </div>
  );
}

function VerdictLine() {
  const { detail: d } = useCheck();
  const est = d.estimate!;
  const t = est.verdictText;
  if (est.mode === "cover" && est.verdict.kind === "cover") {
    return (
      <div className="mt-5 flex gap-2.5 rounded-[9px] border border-hairline px-4 py-3 text-[13px]">
        <span className={clsx("mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full", t.tone === "ok" ? "bg-ok" : "bg-short")} />
        <p>
          <span className="font-[590] text-figure">{t.title}.</span> <span className="text-meta">{t.body}</span>
        </p>
      </div>
    );
  }
  const dot = t.tone === "ok" ? "bg-ok" : t.tone === "warn" ? "bg-warn" : t.tone === "error" ? "bg-bad" : "border border-label";
  return (
    <div className="mt-5 flex gap-2.5 rounded-[9px] border border-hairline px-4 py-3 text-[13px]" role="status">
      <span className={clsx("mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <p>
        <span className="font-[590] text-figure">{t.title}.</span> <span className="text-meta">{t.body}</span>
      </p>
    </div>
  );
}

function RouteRow({ o, first, focused, onFocus, scale, invoice, rateAge, noRank }: { o: OptionView; first: boolean; focused: boolean; onFocus: () => void; scale: { min: number; max: number }; invoice: string | null; rateAge: number | null; noRank: boolean }) {
  const name = o.optionLabel ? `${o.optionLabel}, send ${fmtNum(o.sendAmount)}` : o.label;
  const detail = o.optionLabel
    ? o.isTopUp
      ? "top-up"
      : o.optionLabel === "SHA"
        ? "shared"
        : o.optionLabel === "OUR"
          ? "you pay all charges"
          : "supplier pays all charges"
    : o.speedLabel;
  const tone = o.isFavoured || o.isChosen || (o.isTopUp && o.covers === "even_low") ? "accent" : focused && !noRank ? "accent" : "neutral";
  return (
    <div
      role="radio"
      aria-checked={focused}
      tabIndex={focused ? 0 : -1}
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onFocus();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const sib = (e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null;
          sib?.focus();
          sib?.click();
        }
      }}
      className={clsx(
        "relative cursor-default px-4 py-3.5 transition-colors duration-100 sm:px-5",
        !first && "border-t border-hairline",
        focused ? "bg-group" : "hover:bg-hover/60",
      )}
    >
      {focused && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <div className="min-w-0 text-[13px]">
          <span className="font-[590] text-figure">{name}</span> <span className="text-meta">{detail}</span>
          {o.youPay && <span className="tnum text-meta"> · you pay {fmtNum(o.youPay, 2)}</span>}
          {o.isFavoured && <span className="ml-2 rounded-[4px] bg-accent-soft px-1.5 py-px text-[11px] font-[510] text-[#b4bbff]">More favourable</span>}
          {o.isPlanned && <span className="ml-2 rounded-[4px] border border-hairline-strong px-1.5 py-px text-[11px] text-meta">As planned</span>}
          {o.isChosen && <span className="ml-2 rounded-[4px] bg-accent-soft px-1.5 py-px text-[11px] font-[510] text-[#b4bbff]">Chosen</span>}
        </div>
        <div className="tnum shrink-0 text-[13px] font-[590] text-figure">
          {o.rough && <span className="font-[510] text-meta">≤ </span>}
          {fmtMoney(o.typical, o.destCurrency)} <span className="font-[510] text-meta">· {o.rough ? "rough" : "modelled"}</span>
        </div>
      </div>
      <div className="mt-2.5 hidden sm:block">
        <RangeBar
          low={o.low}
          typical={o.typical}
          high={o.high}
          invoice={invoice}
          scale={scale}
          tone={tone}
          label={`${o.displayLabel}: low ${o.low ?? "unknown"}, typical ${o.typical}, high ${o.high}${invoice ? `, invoice ${invoice}` : ""}`}
        />
      </div>
      <div className="tnum mt-2 flex flex-wrap items-center gap-x-1 text-[13px] text-meta">
        {o.covers === "even_low" && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />}
        {o.covers === "even_low" && <span className="text-label">Even the low estimate covers the invoice ·</span>}
        <span>Low {o.low ? fmtNum(o.low) : "unknown"}</span>·<span>High {fmtNum(o.high)}</span>
        {o.method === "usd_wire" ? (
          <span>· deduction {fmtNum(o.cases.high.deduction)} to {fmtNum(o.cases.low.deduction)}</span>
        ) : o.method === "bank_fx_wire" ? (
          <span>· intermediary deductions possible</span>
        ) : rateAge !== null ? (
          <span>· rate {fmtAgeHours(rateAge)} old</span>
        ) : null}
        {o.covers !== "even_low" && o.covers !== "typical" && invoice && <span>· {o.covers === "short_all" ? "arrives short in every case shown" : "may arrive short"}</span>}
        {o.covers === "typical" && <span>· may arrive short</span>}
        {o.rough && <span className="text-warn">· {o.missing.join(" and ")} unknown</span>}
        {o.quoteReceipt && (
          <Tip content="Provider quote, entered before paying. Stored separately from our estimate.">
            <span className="ml-1 rounded-[4px] border border-hairline-strong px-1.5 text-xs text-label">Quote {fmtNum(o.quoteReceipt)}</span>
          </Tip>
        )}
      </div>
    </div>
  );
}

/** Cost components per route (typical case), with provenance. */
function CostTable() {
  const { detail: d } = useCheck();
  const est = d.estimate!;
  const rows = est.options.filter((o) => !o.isTopUp);
  return (
    <section className="mt-8" aria-label="Cost components">
      <SectionTitle aside="Typical case · all figures modelled from the fee schedule">Cost components</SectionTitle>
      <div className="overflow-x-auto rounded-[9px] border border-hairline">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left text-meta">
              <th scope="col" className="px-4 py-2 font-[510]">Route</th>
              <th scope="col" className="px-3 py-2 text-right font-[510]">Sender fee</th>
              <th scope="col" className="px-3 py-2 text-right font-[510]">FX markup</th>
              <th scope="col" className="px-3 py-2 text-right font-[510]">Deductions</th>
              <th scope="col" className="px-3 py-2 text-right font-[510]">Receiving fee</th>
              <th scope="col" className="px-3 py-2 text-right font-[510]">You pay</th>
              <th scope="col" className="px-3 py-2 text-right font-[510]">
                <Tip content="What you pay minus the mid-market value of what arrives, typical case.">
                  <span className="underline decoration-dotted underline-offset-2">All-in cost</span>
                </Tip>
              </th>
              <th scope="col" className="px-4 py-2 font-[510]">Evidence · age</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {rows.map((o) => {
              const t = o.cases.typical;
              const fee = t.lines.find((l) => l.key === "receiving_fee")!;
              return (
                <tr key={o.optionId} className="border-b border-hairline last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-[510] text-label">{o.displayLabel}</th>
                  <td className="px-3 py-2 text-right text-label">{o.senderFee === null ? <span className="text-warn">unknown</span> : fmtMoney(o.senderFee, o.sourceCurrency, 2)}</td>
                  <td className="px-3 py-2 text-right text-label">{o.method === "usd_wire" ? <span className="text-meta">none</span> : fmtPct(t.markupPct)}</td>
                  <td className="px-3 py-2 text-right text-label">{fmtMoney(t.deduction, o.sourceCurrency)}</td>
                  <td className="px-3 py-2 text-right text-label">{fee.known ? fmtMoney(t.receivingFee, o.destCurrency) : <span className="text-warn">unknown</span>}</td>
                  <td className="px-3 py-2 text-right text-label">{o.youPay ? fmtMoney(o.youPay, o.sourceCurrency, 2) : "—"}</td>
                  <td className="px-3 py-2 text-right text-label">{o.allInCost ? `${fmtMoney(o.allInCost.amount, o.sourceCurrency)} · ${fmtPct(o.allInCost.pct)}` : <span className="text-meta">not bounded</span>}</td>
                  <td className="px-4 py-2 text-label">
                    <span className="inline-flex items-center gap-2">
                      <SourceBadge cls={o.rough ? "unavailable" : o.rule.classification} compact />
                      {o.rule.source} · {fmtAgeHours(o.rule.scheduleAgeDays * 24)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-meta">
        Eligibility for every route shown: approved by counsel (sample). Sender fees are paid on top of the amount sent and never reduce what arrives.
      </p>
    </section>
  );
}

function EditHint() {
  return <p className="mt-2 text-[13px] text-meta">Use “Edit inputs” to change the pay-by date or the providers you hold.</p>;
}

function DraftState() {
  const { detail: d, nickname } = useCheck();
  const i = d.inputs;
  return (
    <div className="mx-auto max-w-[760px]">
      <h1 className="text-[20px] font-[590] text-figure">{nickname}, draft</h1>
      <p className="mt-1.5 text-[13px] text-meta">Inputs are saved. Nothing has been calculated yet, so no amounts are shown.</p>
      <InputsSummary />
      <p className="mt-4 text-[13px] text-meta">
        Use <span className="text-label">Compare routes</span> in the header to estimate it with the current rate and fee schedule.
      </p>
      <section className="mt-8 border-t border-hairline pt-6">
        <SectionTitle>Activity</SectionTitle>
        <ActivityList events={d.events} />
        <NoteBox />
      </section>
      <span className="sr-only">{i.invoiceAmount}</span>
    </div>
  );
}

function CalcErrorState() {
  const { detail: d, nickname, id } = useCheck();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      const r = await apiSend<{ calcError: unknown }>("POST", `/api/checks/${id}/recalculate`);
      if (r.calcError) toast.error("The calculation failed again. Inputs are saved.");
      else toast.success(`${id} estimated.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not retry.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-[760px]">
      <h1 className="text-[20px] font-[590] text-figure">{nickname}</h1>
      <div className="mt-4 rounded-[9px] border border-hairline px-5 py-5" role="alert">
        <div className="text-[14px] font-[590] text-figure">We couldn&apos;t calculate this check</div>
        <p className="mt-1 text-[13px] text-meta">Inputs are saved. No amounts are shown.</p>
        <p className="mt-2 text-xs text-meta">{d.calcError?.message}</p>
        <Button className="mt-3" loading={busy} onClick={retry} icon={<RotateCw size={13} />}>
          Retry
        </Button>
      </div>
      <InputsSummary />
      <section className="mt-8 border-t border-hairline pt-6">
        <SectionTitle>Activity</SectionTitle>
        <ActivityList events={d.events} />
      </section>
    </div>
  );
}

function InputsSummary() {
  const { detail: d } = useCheck();
  const i = d.inputs;
  return (
    <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[9px] border border-hairline bg-hairline text-[13px] sm:grid-cols-3 [&>div]:bg-panel [&>div]:px-4 [&>div]:py-3">
      <div>
        <dt className="text-meta">Invoice</dt>
        <dd className="tnum mt-0.5 font-[590] text-figure">{fmtMoney(i.invoiceAmount, i.invoiceCurrency, 2)}</dd>
      </div>
      <div>
        <dt className="text-meta">You plan to send</dt>
        <dd className="tnum mt-0.5 font-[590] text-figure">{fmtMoney(i.sendAmount, "USD", 2)}</dd>
      </div>
      <div>
        <dt className="text-meta">Pay by</dt>
        <dd className="mt-0.5 text-figure">{fmtDate(i.payBy)}</dd>
      </div>
      <div>
        <dt className="text-meta">Supplier receives</dt>
        <dd className="mt-0.5 text-figure">{PAYOUT_LABEL[i.payoutMethod as keyof typeof PAYOUT_LABEL]}</dd>
      </div>
      <div>
        <dt className="text-meta">Providers</dt>
        <dd className="mt-0.5 text-figure">{providerNames(i.providers)}</dd>
      </div>
      <div>
        <dt className="text-meta">Corridor</dt>
        <dd className="mt-0.5 text-figure">United States → Mexico</dd>
      </div>
    </dl>
  );
}
