"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError } from "@/hooks/use-api";
import { useShell } from "@/components/shell/shell-context";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useCheck } from "./check-context";

/**
 * Record the route the payer will use. Never moves money. When the estimate's rate is stale the
 * user must either record it as stale (the record is flagged) or update the rate first.
 */
export function RecordChoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { id, detail, focus, setFocusId, updateRate } = useCheck();
  const { meta } = useShell();
  const router = useRouter();
  const toast = useToast();
  const est = detail.estimate;
  const [optionId, setOptionId] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [stage, setStage] = useState<"form" | "stale">("form");
  const [staleHours, setStaleHours] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open) return;
    setOptionId(focus?.optionId ?? est?.options[0]?.optionId ?? "");
    setPaidOn(meta?.today ?? "");
    setError("");
    setStage("form");
    setStaleHours(Math.floor(est?.rateAgeHours ?? 0));
  }, [open, focus?.optionId, est, meta?.today]);

  const option = est?.options.find((o) => o.optionId === optionId);

  const submit = async (confirmStale: boolean) => {
    // We already know the rate is stale: ask first instead of letting the server refuse.
    if (!confirmStale && est?.rateStale) {
      setStage("stale");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiSend("POST", `/api/checks/${id}/choice`, { optionId, paidOn, confirmStale });
      onOpenChange(false);
      toast.success(`Choice recorded for ${id}. No money was sent.`);
      router.push(`/checks/${id}/outcome`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_RATE") {
        setStaleHours(Number(e.extra.hours ?? 0));
        setStage("stale");
      } else setError(e instanceof ApiError ? e.message : "Could not record the choice.");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "stale") {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        width={420}
        title={`Record with a ${staleHours}-hour-old rate?`}
        description="The record will be marked stale. Updating the rate adds a new estimate and keeps this one."
        footer={
          <>
            <Button
              onClick={() => {
                setStage("form");
                void submit(true);
              }}
              loading={busy}
            >
              Record as stale
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onOpenChange(false);
                updateRate();
              }}
            >
              Update rate
            </Button>
          </>
        }
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={480}
      title="Record your choice"
      description="This saves which route you will use and freezes the estimate you saw. It does not send or hold any money: you pay in your own bank or provider."
      initialFocus={first}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => submit(false)} disabled={!option || !paidOn}>
            Record choice
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Route" htmlFor="choice-route">
          <Select
            id="choice-route"
            ref={first}
            value={optionId}
            onChange={(e) => {
              setOptionId(e.target.value);
              setFocusId(e.target.value);
            }}
          >
            {est?.options.map((o) => (
              <option key={o.optionId} value={o.optionId}>
                {o.displayLabel}
                {o.isFavoured ? " · more favourable" : ""}
                {o.rough ? " · rough estimate" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {option && (
          <div className="rounded-[8px] border border-hairline bg-panel px-3.5 py-3 text-[13px]">
            <div className="text-label">
              Expected <b className="tnum font-[590] text-figure">{fmtMoney(option.typical, option.destCurrency)}</b>
              {option.low ? (
                <>
                  , at least <span className="tnum">{fmtNum(option.low)}</span>
                </>
              ) : (
                ", floor unknown"
              )}{" "}
              (modelled)
            </div>
            <div className="mt-1 text-meta">
              You send {fmtMoney(option.sendAmount, option.sourceCurrency, 2)}
              {option.youPay && <> and pay {fmtMoney(option.youPay, option.sourceCurrency, 2)} with the sending fee</>} · {option.speedLabel}
            </div>
            {option.rough && <div className="mt-1 text-warn">Rough estimate: {option.missing.join(" and ")} unknown. The supplier may receive less.</div>}
          </div>
        )}
        <Field label="Planned payment date" htmlFor="choice-date" hint="A reply from the supplier is due 3 days after this date.">
          <Input id="choice-date" type="date" className="tnum" value={paidOn} min={meta?.today} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        {est?.rateStale && (
          <p className="text-xs text-warn">The rate behind this estimate is {Math.floor(est.rateAgeHours ?? 0)} hours old. You will be asked to confirm or update it.</p>
        )}
        {error && <p role="alert" className="text-xs text-bad-text">{error}</p>}
      </div>
    </Dialog>
  );
}
