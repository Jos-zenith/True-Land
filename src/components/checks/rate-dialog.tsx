"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError } from "@/hooks/use-api";
import { useShell } from "@/components/shell/shell-context";
import { fmtAgeHours, fmtRate } from "@/lib/format";

/** Manual rate entry. There is no live feed: the rate is labelled "Manually entered" with its stated source. */
export function RateDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { meta } = useShell();
  const toast = useToast();
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setRate(meta?.rate?.rate ?? "");
      setNote("");
      setErrors({});
    }
  }, [open, meta?.rate?.rate]);

  const save = async () => {
    setBusy(true);
    try {
      await apiSend("POST", "/api/rates", { rate, sourceNote: note });
      toast.success(`Rate ${rate} entered manually. Existing estimates are unchanged.`);
      onDone();
    } catch (e) {
      setErrors(e instanceof ApiError ? { ...e.fields, _form: Object.keys(e.fields).length ? "" : e.message } : { _form: "Could not save the rate." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Enter a USD/MXN rate"
      description="Reference rates can be fetched in Data sources. A rate you enter here is labelled “Manually entered” with the source you give, and is stale after 24 hours."
      initialFocus={first}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save rate
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {meta?.rate && (
          <p className="text-xs text-meta">
            Latest: {fmtRate(meta.rate.rate)} · {meta.rate.source} · {fmtAgeHours(meta.rate.hours)} old{meta.rate.stale ? " (stale)" : ""}
          </p>
        )}
        <Field label="Mid-market rate, MXN per 1 USD" htmlFor="rate-v" error={errors.rate}>
          <Input id="rate-v" ref={first} inputMode="decimal" className="tnum" value={rate} onChange={(e) => setRate(e.target.value)} invalid={!!errors.rate} />
        </Field>
        <Field label="Where this rate came from" htmlFor="rate-src" error={errors.sourceNote} hint="For example: “Bank A treasury desk, 09:00”.">
          <Input id="rate-src" value={note} onChange={(e) => setNote(e.target.value)} invalid={!!errors.sourceNote} maxLength={80} />
        </Field>
        {errors._form && <p className="text-xs text-bad-text">{errors._form}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
