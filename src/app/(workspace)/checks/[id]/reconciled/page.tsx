"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { clsx } from "clsx";
import { ArrowRight, FilePlus2, PenLine } from "lucide-react";
import { useCheck } from "@/components/checks/check-context";
import { CepPanel } from "@/components/checks/cep-panel";
import { ActivityList } from "@/components/finance/activity";
import { RangeBar, sharedScale } from "@/components/finance/range-bar";
import { StatCell, StatGrid } from "@/components/finance/money";
import { Button } from "@/components/ui/button";
import { EvidenceWord } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/field";
import { Dialog, Sheet } from "@/components/ui/overlay";
import { SectionTitle } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError } from "@/hooks/use-api";
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtSignedMoney, fmtStamp } from "@/lib/format";
import { EVIDENCE_LABEL, REPORTED_BY_LABEL } from "@/lib/labels";

export default function ReconciledPage() {
  const { detail: d, nickname, id } = useCheck();
  const [correct, setCorrect] = useState(false);
  const [sheet, setSheet] = useState(false);
  const r = d.reconciliation;

  if (!r) {
    return (
      <div className="mx-auto max-w-[760px]">
        <h1 className="text-[20px] font-[590] text-figure">{nickname}: not reconciled yet</h1>
        <p className="mt-2 text-[13px] text-meta">Record the amount received to compare it with the original estimate.</p>
        {d.choice && (
          <Link href={`/checks/${id}/outcome`} className="mt-3 inline-flex items-center gap-1 text-[13px] font-[510] text-accent-hover">
            Record outcome <ArrowRight size={13} />
          </Link>
        )}
      </div>
    );
  }

  const cur = r.currency;
  const ourAbs = Math.abs(Number(r.ourError));
  const quoteAbs = r.quoteError !== null ? Math.abs(Number(r.quoteError)) : null;
  const scale = sharedScale([r.low ?? r.expected, r.high, r.actual, r.quote, r.invoice]);

  return (
    <div className="mx-auto max-w-[760px]">
      <h1 className="text-[20px] font-[590] tracking-[-0.015em] text-figure">{nickname}, reconciled</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-meta">{r.sentence}</p>

      <div className="mt-5">
        <StatGrid>
          <StatCell label="Expected, typical" value={fmtMoney(r.expected, cur)} sub="Modelled" />
          <StatCell label="Actual" value={fmtMoney(r.actual, cur)} sub={<EvidenceWord level={r.level} />} />
          <StatCell label="Provider quote" value={r.quote ? fmtMoney(r.quote, cur) : "None given"} muted={!r.quote} sub={r.quote ? "Entered before paying" : "No quote recorded"} />
          <StatCell
            label="Against invoice"
            value={r.againstInvoice !== null ? fmtSignedMoney(r.againstInvoice, cur).replace(/^\+/, "+") : "—"}
            sub={r.invoice ? `Invoice ${fmtNum(r.invoice)}` : "Different currency"}
          />
        </StatGrid>
      </div>

      <section className="mt-6" aria-label="Original estimate range">
        <SectionTitle aside={<span className="tnum">Scale {fmtNum(scale.min)} to {fmtNum(scale.max)} {cur}</span>}>Original estimate range</SectionTitle>
        <div className="rounded-[9px] border border-hairline px-4 py-3.5 sm:px-5">
          <RangeBar
            low={r.low}
            typical={r.expected}
            high={r.high}
            invoice={r.invoice}
            actual={r.actual}
            scale={scale}
            tone="accent"
            label={`Estimate range ${r.low ?? "unknown"} to ${r.high}, typical ${r.expected}; actual ${r.actual}`}
          />
          <div className="tnum mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-meta">
            <span>
              Low {r.low ? fmtNum(r.low) : "unknown"} · typical {fmtNum(r.expected)} · high {fmtNum(r.high)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              · <span aria-hidden className="inline-block h-2 w-2 rotate-45 rounded-[1px] bg-short" /> actual {fmtNum(r.actual)},{" "}
              <span className="text-label">{r.insideRange === null ? "range floor unknown" : r.insideRange ? "inside the range" : "outside the range"}</span>
            </span>
          </div>
          <p className="mt-1 text-xs text-meta">The estimate shown is the snapshot frozen when the route was chosen. It is never recalculated with current rates.</p>
        </div>
      </section>

      <section className="mt-6" aria-label="Which was closer">
        <SectionTitle>Which was closer?</SectionTitle>
        <div className="overflow-x-auto rounded-[9px] border border-hairline">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-left text-meta">
                <th scope="col" className="px-4 py-2.5 font-[510]">Prediction</th>
                <th scope="col" className="px-3 py-2.5 font-[510]">Error</th>
                <th scope="col" className="px-4 py-2.5 font-[510]">How it is defined</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-hairline">
                <th scope="row" className="px-4 py-2.5 text-left font-[510] text-label">Our estimate</th>
                <td className="tnum px-3 py-2.5 font-[590] text-figure">
                  {fmtSignedMoney(r.ourError, cur)}
                  {r.ourErrorPct && <span className="ml-1.5 font-[510] text-meta">{fmtPct(r.ourErrorPct, 3)}</span>}
                </td>
                <td className="px-4 py-2.5 text-meta">
                  actual − estimate: {Number(r.ourError) === 0 ? "arrived exactly as estimated" : `arrived ${fmtNum(ourAbs)} ${Number(r.ourError) < 0 ? "below" : "above"} it`}
                </td>
              </tr>
              <tr className="border-b border-hairline">
                <th scope="row" className="px-4 py-2.5 text-left font-[510] text-label">Provider quote</th>
                <td className="tnum px-3 py-2.5 font-[590] text-figure">{r.quoteError !== null ? fmtSignedMoney(r.quoteError, cur) : <span className="font-[510] text-meta">none given</span>}</td>
                <td className="px-4 py-2.5 text-meta">
                  quote − actual
                  {r.quoteError !== null && `: quote was ${fmtNum(quoteAbs!)} ${Number(r.quoteError) > 0 ? "too high" : Number(r.quoteError) < 0 ? "too low" : "exact"}`}
                </td>
              </tr>
              <tr>
                <th scope="row" className="px-4 py-2.5 text-left font-[510] text-label">Closer</th>
                <td className="tnum px-3 py-2.5 font-[590] text-figure">
                  {r.closer === null ? <span className="font-[510] text-meta">no quote to compare</span> : r.closer === "tie" ? "Tie" : `${r.closer === "ours" ? "Ours" : "Quote"}, by ${fmtNum(r.closerBy!)}`}
                </td>
                <td className="px-4 py-2.5 text-meta">
                  {r.closer === null ? "Add quotes before paying to compare." : `compares sizes: ${fmtNum(ourAbs)} against ${fmtNum(quoteAbs!)}. One payment proves nothing yet.`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-[9px] border border-hairline px-4 py-3.5 sm:px-5" aria-label="What remains unknown">
        <h2 className="text-[13px] font-[590] text-figure">What remains unknown</h2>
        <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-meta">
          {r.unknowns.map((u) => (
            <li key={u}>{u}</li>
          ))}
          <li>{r.feeNote}</li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {d.actions.canCorrect && (
            <Button size="sm" icon={<PenLine size={12} />} onClick={() => setCorrect(true)}>
              Correct amount
            </Button>
          )}
          {d.actions.canAddEvidence && r.level !== "verified" && d.inputs.payoutMethod === "spei_mxn" && (
            <Button size="sm" icon={<FilePlus2 size={12} />} onClick={() => setSheet(true)}>
              Add evidence
            </Button>
          )}
        </div>
      </section>

      <section className="mt-6" aria-label="Outcome record">
        <SectionTitle>Outcome record</SectionTitle>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[9px] border border-hairline bg-hairline text-[13px] sm:grid-cols-4 [&>div]:bg-panel [&>div]:px-4 [&>div]:py-3">
          <div>
            <dt className="text-meta">Selected route</dt>
            <dd className="mt-0.5 text-label">{d.choice?.displayLabel}</dd>
          </div>
          <div>
            <dt className="text-meta">Reported by</dt>
            <dd className="mt-0.5 text-label">{r.reportedBy ? REPORTED_BY_LABEL[r.reportedBy] : "—"}</dd>
          </div>
          <div>
            <dt className="text-meta">Date received</dt>
            <dd className="mt-0.5 text-label">{fmtDate(r.date)}</dd>
          </div>
          <div>
            <dt className="text-meta">Evidence</dt>
            <dd className="mt-0.5 text-label">{EVIDENCE_LABEL[r.level]}</dd>
          </div>
        </dl>
        {d.outcomeHistory.length > 1 && (
          <ol className="mt-3 flex flex-col gap-1 text-xs text-meta">
            {d.outcomeHistory.map((o, i) => (
              <li key={o.id} className={clsx("tnum", i === d.outcomeHistory.length - 1 && "text-label")}>
                {fmtStamp(o.at)} · {o.result === "received" ? fmtMoney(o.amount, o.currency ?? cur) : o.result} · {EVIDENCE_LABEL[o.level]} · {o.byName}
                {o.correctionOf ? " · supersedes the previous entry" : ""}
                {i === d.outcomeHistory.length - 1 ? " · current" : ""}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8 border-t border-hairline pt-6" aria-label="Activity">
        <SectionTitle>Activity</SectionTitle>
        <ActivityList events={d.events} />
        <p className="mt-3 text-[13px] text-meta">Entries are never edited or removed. A correction adds a new entry and the old one stays.</p>
      </section>

      <CorrectDialog open={correct} onOpenChange={setCorrect} current={r.actual} currency={cur} />
      <Sheet open={sheet} onOpenChange={setSheet} title={`Add evidence to ${id}`} description="Type: SPEI receipt (CEP)" width={420}>
        <CepPanel checkId={id} amount={Number(r.actual).toLocaleString("en-US")} date={r.date} compact />
      </Sheet>
    </div>
  );
}

function CorrectDialog({ open, onOpenChange, current, currency }: { open: boolean; onOpenChange: (o: boolean) => void; current: string; currency: string }) {
  const { id } = useCheck();
  const toast = useToast();
  const [v, setV] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await apiSend("POST", `/api/checks/${id}/correction`, { amount: v });
      toast.success("Correction added. The previous entry stays in the history.");
      onOpenChange(false);
      setV("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.fields.amount ?? e.message : "Could not save the correction.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Correct the amount received"
      description={`Currently ${fmtMoney(current, currency)}. A correction adds a new entry; the old one stays. A verification made for the old amount no longer applies.`}
      initialFocus={ref}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!v.trim()}>
            Add correction
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={`Corrected amount, ${currency}`} htmlFor="corr" error={err}>
          <Input id="corr" ref={ref} inputMode="decimal" className="tnum" value={v} onChange={(e) => setV(e.target.value)} invalid={!!err} />
        </Field>
      </form>
    </Dialog>
  );
}
