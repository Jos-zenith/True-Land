"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { ArrowRight, Copy } from "lucide-react";
import { useCheck } from "@/components/checks/check-context";
import { CepPanel } from "@/components/checks/cep-panel";
import { PlanChangeDialog } from "@/components/checks/plan-change";
import { supplierRequestText, useCheckActions } from "@/components/checks/check-row";
import { ActivityList } from "@/components/finance/activity";
import { Button } from "@/components/ui/button";
import { EvidenceWord } from "@/components/ui/chip";
import { Field, Input, Radio, Segmented, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { SectionTitle } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { useShell } from "@/components/shell/shell-context";
import { apiSend, ApiError } from "@/hooks/use-api";
import { fmtDate, fmtMoney, fmtNum, fmtStamp } from "@/lib/format";
import { REPORTED_BY_LABEL } from "@/lib/labels";
import { outcomeSchema, zodFieldErrors } from "@/lib/schemas";

type Result = "received" | "no_reply" | "refused";

export default function OutcomePage() {
  const { detail: d, nickname, id } = useCheck();
  const { meta } = useShell();
  const router = useRouter();
  const toast = useToast();
  const actions = useCheckActions();
  const today = meta?.today ?? "";
  const choice = d.choice;
  const [result, setResult] = useState<Result>("received");
  const [f, setF] = useState({ amount: "", date: "", reportedBy: "supplier" as "supplier" | "payer" | "provider_statement", reference: "", level: "reported" as "reported" | "tax_record" });
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [verifiedAmount, setVerifiedAmount] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<{ open: boolean; next: string }>({ open: false, next: "" });
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (today && !f.date) setF((x) => ({ ...x, date: today }));
  }, [today, f.date]);

  if (!choice) {
    return (
      <div className="mx-auto max-w-[760px]">
        <h1 className="text-[20px] font-[590] text-figure">{nickname}: no route recorded yet</h1>
        <p className="mt-2 text-[13px] text-meta">Record the route you will use on the Compare tab first. The outcome is captured after you pay.</p>
        <Link href={`/checks/${id}/compare`} className="mt-3 inline-flex items-center gap-1 text-[13px] font-[510] text-accent-hover">
          Go to Compare <ArrowRight size={13} />
        </Link>
      </div>
    );
  }

  const s = choice.snapshot;
  const cur = s.currency;
  const isSpei = d.inputs.payoutMethod === "spei_mxn";
  const request = supplierRequestText({ id, route: choice.displayLabel, sendAmount: s.sendAmount, currency: cur, paidOn: choice.paidOn });
  const locked = d.summary.status === "reconciled" || d.summary.status === "refused";
  const verifiedMatches = !!evidenceId && verifiedAmount !== null && verifiedAmount.replace(/,/g, "") === f.amount.replace(/,/g, "");

  const submit = async () => {
    const body =
      result === "received"
        ? { result, amount: f.amount, date: f.date, reportedBy: f.reportedBy, reference: f.reference || null, level: f.level, evidenceId: verifiedMatches ? evidenceId : null }
        : result === "refused"
          ? { result, date: f.date, reference: f.reference || null }
          : { result, date: f.date };
    const parsed = outcomeSchema.safeParse(body);
    const errs: Record<string, string> = parsed.success ? {} : zodFieldErrors(parsed.error);
    if (f.date > today) errs.date = "The date cannot be in the future.";
    if (Object.keys(errs).length) {
      setErrors(errs);
      (errs.amount ? amountRef : dateRef).current?.focus();
      return;
    }
    setBusy(true);
    try {
      await apiSend("POST", `/api/checks/${id}/outcome`, parsed.data);
      toast.success(
        result === "received"
          ? `Outcome saved for ${id}. ${verifiedMatches ? "Verified by the system." : "Evidence: reported, not verified."}`
          : result === "no_reply"
            ? `Recorded as no reply for ${id}. It still counts in the pilot results.`
            : `Recorded as refused for ${id}.`,
      );
      setPlan({ open: true, next: result === "received" ? `/checks/${id}/reconciled` : `/checks/${id}/outcome` });
    } catch (e) {
      if (e instanceof ApiError) setErrors(Object.keys(e.fields).length ? e.fields : { _form: e.message });
      else setErrors({ _form: "Could not save the outcome." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[760px]">
      <h1 className="text-[20px] font-[590] tracking-[-0.015em] text-figure">{nickname}: what happened?</h1>
      <div className="mt-4 rounded-[9px] border border-hairline px-4 py-3 text-[13px] text-label sm:px-5">
        Snapshot of the choice: {choice.displayLabel} · expected <span className="tnum">{fmtMoney(s.typical, cur)}</span>
        {s.low ? (
          <>
            , at least <span className="tnum">{fmtNum(s.low)}</span>
          </>
        ) : (
          ", floor unknown"
        )}{" "}
        (modelled)
        {s.quote && (
          <>
            {" "}
            · quote <span className="tnum">{fmtMoney(s.quote, cur)}</span>
          </>
        )}{" "}
        · saved {fmtStamp(choice.at)}
        {choice.recordedStale && <span className="text-warn"> · recorded with a {choice.rateAgeHours}-hour-old rate (stale)</span>}
      </div>

      {d.actions.replyOverdue && (
        <Notice
          tone="short"
          className="mt-4"
          title={`Reply was due ${fmtDate(choice.replyDue)}`}
          action={
            <Button size="sm" icon={<Copy size={12} />} onClick={() => actions.copyRequest(request)}>
              Copy reminder
            </Button>
          }
        >
          Choose Received, No reply or Refused.
        </Notice>
      )}
      {d.summary.status === "no_reply" && (
        <Notice className="mt-4" title="Recorded as no reply">
          It still counts in the pilot results. If the supplier replies late, record Received below; the late reply is added as a new event.
        </Notice>
      )}

      {locked ? (
        <RecordedOutcome />
      ) : (
        <form
          id="outcome-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="mt-5"
        >
          <Segmented
            label="Outcome"
            value={result}
            onChange={(v) => {
              setResult(v);
              setErrors({});
            }}
            options={[
              { value: "received", label: "Received" },
              { value: "no_reply", label: "No reply", disabled: d.summary.status === "no_reply" },
              { value: "refused", label: "Refused" },
            ]}
          />

          {result === "received" ? (
            <div className="mt-5 flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Reported by" htmlFor="o-by">
                  <Select id="o-by" value={f.reportedBy} onChange={(e) => setF({ ...f, reportedBy: e.target.value as typeof f.reportedBy })}>
                    <option value="supplier">Supplier</option>
                    <option value="payer">Us (payer)</option>
                    <option value="provider_statement">Bank or provider statement</option>
                  </Select>
                </Field>
                <Field label="Date of reply or check" htmlFor="o-date" error={errors.date}>
                  <Input id="o-date" ref={dateRef} type="date" className="tnum" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} invalid={!!errors.date} />
                </Field>
              </div>
              <Field label={`Amount received, ${cur}`} htmlFor="o-amt" error={errors.amount} className="sm:max-w-[360px]">
                <input
                  id="o-amt"
                  ref={amountRef}
                  inputMode="decimal"
                  autoFocus
                  value={f.amount}
                  onChange={(e) => {
                    setF({ ...f, amount: e.target.value });
                    setErrors((x) => ({ ...x, amount: "" }));
                  }}
                  onBlur={() => {
                    const n = f.amount.replace(/,/g, "");
                    if (/^\d+(\.\d+)?$/.test(n)) setF((x) => ({ ...x, amount: Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) }));
                  }}
                  aria-invalid={!!errors.amount || undefined}
                  placeholder="0"
                  className={clsx(
                    "figure h-12 w-full rounded-[7px] border bg-panel px-3 text-[24px] font-[590] text-figure placeholder:text-deco focus-visible:border-ring focus-visible:outline-none",
                    errors.amount ? "border-bad" : "border-control-soft hover:border-control",
                  )}
                />
              </Field>
              <Field label="Reference" htmlFor="o-ref" optional className="sm:max-w-[360px]">
                <Input id="o-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={60} placeholder="Supplier's remittance note or tracking key" />
              </Field>
              <fieldset className="rounded-[9px] border border-hairline px-4 pb-3.5 pt-2">
                <legend className="px-1 text-[13px] text-meta">Evidence you hold</legend>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
                  <Radio name="lvl" value="reported" checked={f.level === "reported"} onChange={() => setF({ ...f, level: "reported" })} label="Reported" />
                  <Radio name="lvl" value="tax" checked={f.level === "tax_record"} onChange={() => setF({ ...f, level: "tax_record" })} label="Tax record" hint="(may show full, not net)" />
                  <span className="text-[13px] text-meta">Verified is set by the system only.</span>
                </div>
                {f.reportedBy === "provider_statement" && f.level === "reported" && (
                  <p className="mt-2 text-xs text-meta">A statement you type in is still “Reported”. It becomes Verified only if a receipt check passes.</p>
                )}
                {verifiedMatches && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-ok-text">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok" /> A receipt check passed for this amount. The outcome will be saved as Verified.
                  </p>
                )}
                {evidenceId && !verifiedMatches && <p className="mt-2 text-xs text-warn">The verified receipt was for {verifiedAmount}. Change the amount back, or it will be saved as Reported.</p>}
              </fieldset>
              {isSpei ? (
                <CepPanel
                  checkId={id}
                  amount={f.amount}
                  date={f.date}
                  onVerified={(evId, amt) => {
                    setEvidenceId(evId);
                    setVerifiedAmount(Number(amt).toLocaleString("en-US", { maximumFractionDigits: 2 }));
                    if (!f.amount) setF((x) => ({ ...x, amount: Number(amt).toLocaleString("en-US", { maximumFractionDigits: 2 }) }));
                  }}
                  onCorrectAmount={(a) => setF((x) => ({ ...x, amount: Number(a).toLocaleString("en-US", { maximumFractionDigits: 2 }) }))}
                />
              ) : (
                <p className="text-[13px] text-meta">Receipt checks (CEP) apply to SPEI peso payouts only. For a USD wire, keep the supplier&apos;s bank credit advice; the amount stays “Reported”.</p>
              )}
            </div>
          ) : result === "no_reply" ? (
            <div className="mt-5 max-w-[520px]">
              <p className="text-[13px] text-label">Record that the supplier did not reply. It still counts in the pilot results, and a late reply can be added later.</p>
              <Field label="Date" htmlFor="o-date2" error={errors.date} className="mt-4 max-w-[240px]">
                <Input id="o-date2" ref={dateRef} type="date" className="tnum" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
              </Field>
              <Button className="mt-4 h-11 w-full sm:h-7 sm:w-auto" icon={<Copy size={13} />} onClick={() => actions.copyRequest(request)}>
                Copy reminder
              </Button>
            </div>
          ) : (
            <div className="mt-5 max-w-[520px]">
              <p className="text-[13px] text-label">The supplier declined to share the amount received. No amount is recorded.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Date" htmlFor="o-date3" error={errors.date}>
                  <Input id="o-date3" ref={dateRef} type="date" className="tnum" max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
                </Field>
                <Field label="Note" htmlFor="o-note" optional>
                  <Input id="o-note" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={60} />
                </Field>
              </div>
            </div>
          )}
          {errors._form && <p role="alert" className="mt-3 text-[13px] text-bad-text">{errors._form}</p>}
          <div className="mt-6 flex items-center gap-3 border-t border-hairline pt-4">
            <Button type="submit" variant="primary" loading={busy} className="h-11 flex-1 sm:h-7 sm:flex-none">
              Save outcome
            </Button>
            <span className="hidden text-xs text-meta sm:inline">Saving never changes the original estimate.</span>
          </div>
        </form>
      )}

      <section className="mt-10 border-t border-hairline pt-6" aria-label="Activity">
        <SectionTitle>Activity</SectionTitle>
        <ActivityList events={d.events} />
      </section>

      <PlanChangeDialog
        checkId={id}
        open={plan.open}
        onDone={() => {
          const next = plan.next;
          setPlan({ open: false, next: "" });
          router.push(next);
        }}
      />
    </div>
  );
}

function RecordedOutcome() {
  const { detail: d, id } = useCheck();
  const o = d.outcome!;
  return (
    <div className="mt-5 rounded-[9px] border border-hairline px-5 py-4 text-[13px]">
      <div className="font-[590] text-figure">
        {o.result === "received" ? `Received ${fmtMoney(o.amount, o.currency ?? "MXN")}` : o.result === "refused" ? "Refused" : "No reply"}
      </div>
      <p className="mt-1 text-meta">
        {o.result === "received" && o.reportedBy && <>Reported by {REPORTED_BY_LABEL[o.reportedBy].toLowerCase()} · </>}
        {fmtDate(o.date)} · recorded by {o.byName}
        {o.result === "received" && (
          <>
            {" "}
            · <EvidenceWord level={o.level} />
          </>
        )}
      </p>
      {d.outcomeHistory.length > 1 && (
        <p className="mt-2 text-xs text-meta">
          {d.outcomeHistory.length - 1} earlier entr{d.outcomeHistory.length - 1 > 1 ? "ies are" : "y is"} kept in the history below. Entries are never edited or removed.
        </p>
      )}
      {o.result === "received" && (
        <Link href={`/checks/${id}/reconciled`} className="mt-3 inline-flex items-center gap-1 font-[510] text-accent-hover">
          View reconciliation <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}
