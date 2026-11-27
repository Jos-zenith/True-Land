"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useShell } from "@/components/shell/shell-context";
import { apiSend, ApiError } from "@/hooks/use-api";
import { fmtMoney } from "@/lib/format";
import type { EvidenceRecord } from "@/server/model";

type Stage = { kind: "idle" } | { kind: "checking"; label: string } | { kind: "done"; ev: EvidenceRecord } | { kind: "error"; message: string };

/**
 * SPEI receipt (CEP) check.
 *  - DEMO (demo workspaces only): three labelled fixtures. Nothing is parsed and Banxico is never
 *    contacted. A pass is recorded as "Verified (demo)", never "Verified".
 *  - LIVE (only when the deployment configures a verification provider): the server asks the provider
 *    and records its signed answer. A pass is recorded as "Verified".
 * The beneficiary account is sent for this check only and is never stored.
 */
export function CepPanel({
  checkId,
  amount,
  date,
  onVerified,
  onCorrectAmount,
  compact,
}: {
  checkId: string;
  amount: string;
  date: string;
  onVerified?: (evidenceId: string, amount: string) => void;
  onCorrectAmount?: (fileAmount: string) => void;
  compact?: boolean;
}) {
  const { meta } = useShell();
  const demoOn = !!meta?.verification.demo;
  const liveOn = !!meta?.verification.live;
  const [f, setF] = useState({ amount: "", date: "", sendingBank: demoOn ? "Sample bank 1" : "", receivingBank: demoOn ? "Sample bank 2" : "", trackingKey: "", account: "" });
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const amt = f.amount || amount;
  const dt = f.date || date;

  const run = async (req: { mode: "demo"; demo: "match" | "mismatch" | "unreadable" } | { mode: "live" }) => {
    setErrors({});
    setStage({ kind: "checking", label: req.mode === "demo" ? "Checking the demo file…" : "Asking the verification provider…" });
    try {
      const res = await apiSend<{ evidence: EvidenceRecord }>("POST", `/api/checks/${checkId}/cep`, {
        ...req,
        amount: amt.replace(/,/g, ""),
        date: dt,
        sendingBank: f.sendingBank,
        receivingBank: f.receivingBank,
        trackingKey: f.trackingKey || null,
        beneficiaryAccount: f.account || null,
      });
      setStage({ kind: "done", ev: res.evidence });
      setF((x) => ({ ...x, account: "" })); // discard the account from the browser too
      if (res.evidence.result === "verified") onVerified?.(res.evidence.id, res.evidence.entered.amount);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
      setStage({ kind: "error", message: e instanceof ApiError ? e.message : "The check failed, try again." });
    }
  };

  const isDemo = stage.kind === "done" && stage.ev.mode === "demo";

  return (
    <section className={clsx("rounded-[9px] border border-hairline", compact ? "px-4 py-4" : "px-5 py-5")} aria-label="Check a bank record or SPEI receipt">
      <h2 className="text-[13px] font-[590] text-figure">Check a bank record or SPEI receipt (CEP)</h2>
      <p className="mt-1 text-[13px] text-meta">Enter the receipt details. {liveOn ? "A live check asks this deployment's verification provider." : "Live verification is not configured on this deployment."}</p>
      <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
        <Field label="Amount" htmlFor="cep-amt" error={errors.amount}>
          <Input id="cep-amt" inputMode="decimal" className="tnum" placeholder={amount || "253,100"} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Date" htmlFor="cep-date" error={errors.date}>
          <Input id="cep-date" type="date" className="tnum" value={dt} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Sending bank" htmlFor="cep-sb" error={errors.sendingBank}>
          <Input id="cep-sb" value={f.sendingBank} onChange={(e) => setF({ ...f, sendingBank: e.target.value })} />
        </Field>
        <Field label="Receiving bank" htmlFor="cep-rb" error={errors.receivingBank}>
          <Input id="cep-rb" value={f.receivingBank} onChange={(e) => setF({ ...f, receivingBank: e.target.value })} />
        </Field>
        <Field label="Tracking key or reference" htmlFor="cep-tk" error={errors.trackingKey}>
          <Input id="cep-tk" placeholder="Clave de rastreo" value={f.trackingKey} onChange={(e) => setF({ ...f, trackingKey: e.target.value })} />
        </Field>
        <Field label="Beneficiary account" htmlFor="cep-acct" error={errors.beneficiaryAccount}>
          <Input id="cep-acct" inputMode="numeric" autoComplete="off" placeholder="CLABE, 18 digits" maxLength={18} value={f.account} onChange={(e) => setF({ ...f, account: e.target.value.replace(/\D/g, "") })} />
        </Field>
      </div>
      <p className="mt-3 text-[13px] font-[510] text-label">Beneficiary account details are used for this check and are not stored.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {liveOn && (
          <Button variant="primary" disabled={stage.kind === "checking"} onClick={() => run({ mode: "live" })}>
            Verify with provider
          </Button>
        )}
        {demoOn && (
          <>
            <Button className="border-dashed" disabled={stage.kind === "checking"} onClick={() => run({ mode: "demo", demo: "match" })}>
              Demo file: matches
            </Button>
            <Button className="border-dashed" disabled={stage.kind === "checking"} onClick={() => run({ mode: "demo", demo: "mismatch" })}>
              Demo file: mismatch
            </Button>
            <Button className="border-dashed" disabled={stage.kind === "checking"} onClick={() => run({ mode: "demo", demo: "unreadable" })}>
              Demo file: unreadable
            </Button>
          </>
        )}
      </div>
      {demoOn && (
        <p className="mt-2 text-xs text-meta">
          Demo buttons use sample files. No receipt is read and Banxico is never contacted. A demo match is recorded as “Verified (demo)”, not “Verified”.
        </p>
      )}
      {!demoOn && !liveOn && <p className="mt-2 text-xs text-meta">No receipt verification is available on this deployment. The evidence level stays as reported.</p>}

      <div aria-live="polite" className="mt-3">
        {stage.kind === "checking" && (
          <div>
            <div className="text-[13px] font-[590] text-figure">{stage.label}</div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-group">
              <div className="h-full w-1/2 animate-shimmer rounded-full bg-accent" />
            </div>
            <p className="mt-1.5 text-xs text-meta">Evidence stays “Reported” until a check passes.</p>
          </div>
        )}
        {stage.kind === "done" && stage.ev.result === "verified" && (
          <div>
            <div className={clsx("flex items-center gap-1.5 text-[13px] font-[590]", isDemo ? "text-label" : "text-ok-text")}>
              <span className={clsx("h-1.5 w-1.5 rounded-full", isDemo ? "bg-meta" : "bg-ok")} /> {isDemo ? "Demo file matched (not a real verification)" : "Verified by the system"}
            </div>
            <p className="mt-1 text-[13px] text-label">{stage.ev.detail}</p>
            <p className="mt-0.5 text-xs text-meta">The beneficiary account was used for this check and not stored.</p>
          </div>
        )}
        {stage.kind === "done" && stage.ev.result === "mismatch" && (
          <div>
            <div className="text-[13px] font-[590] text-short">Amount does not match{isDemo ? " (demo file)" : ""}</div>
            <p className="mt-1 text-[13px] text-label">{stage.ev.detail}</p>
            <div className="mt-2 flex gap-2">
              {onCorrectAmount && stage.ev.file && (
                <Button size="sm" onClick={() => onCorrectAmount(stage.ev.file!.amount)}>
                  Correct amount to {fmtMoney(stage.ev.file.amount, "MXN")}
                </Button>
              )}
              <Button size="sm" onClick={() => setStage({ kind: "idle" })}>
                Try again
              </Button>
            </div>
          </div>
        )}
        {stage.kind === "done" && (stage.ev.result === "unreadable" || stage.ev.result === "invalid_account" || stage.ev.result === "not_found") && (
          <div>
            <div className="text-[13px] font-[590] text-short">
              {stage.ev.result === "unreadable" ? "Receipt could not be read" : stage.ev.result === "not_found" ? "No receipt found" : "Account not valid"}
            </div>
            <p className="mt-1 text-[13px] text-label">{stage.ev.detail} The evidence level is unchanged.</p>
            <Button size="sm" className="mt-2" onClick={() => setStage({ kind: "idle" })}>
              Retry
            </Button>
          </div>
        )}
        {stage.kind === "error" && <p className="text-[13px] text-bad-text">{stage.message}</p>}
      </div>
    </section>
  );
}
