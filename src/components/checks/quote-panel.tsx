"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Segmented, Select, controlClass } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError } from "@/hooks/use-api";
import { fmtMoney, fmtStamp } from "@/lib/format";
import { quoteSchema, zodFieldErrors } from "@/lib/schemas";
import { useCheck } from "./check-context";
import { clsx } from "clsx";

/**
 * Provider quote entry (wireframe: properties panel). The quote is stored as a provider quote and
 * analysed against our estimate. It never replaces the modelled estimate.
 */
export function QuotePanel() {
  const { id, detail, focus } = useCheck();
  const toast = useToast();
  const est = detail.estimate!;
  const quotable = est.options.filter((o) => !o.isTopUp);
  const [ruleId, setRuleId] = useState(focus && !focus.isTopUp ? focus.ruleId : quotable[0]?.ruleId ?? "");
  const [kind, setKind] = useState<"amount" | "rate">("amount");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (focus && !focus.isTopUp) setRuleId(focus.ruleId);
  }, [focus]);

  const option = quotable.find((o) => o.ruleId === ruleId);
  const existing = detail.quotes.filter((q) => q.ruleId === ruleId && q.current)[0];
  const routeName = option?.label.split(",")[0] ?? "Provider";

  const save = async () => {
    setError("");
    const parsed = quoteSchema.safeParse({ ruleId, kind, value });
    if (!parsed.success) {
      setError(Object.values(zodFieldErrors(parsed.error))[0]);
      return;
    }
    setBusy(true);
    try {
      await apiSend("POST", `/api/checks/${id}/quote`, parsed.data);
      toast.success(`${routeName} quote saved to ${id}.`);
      setValue("");
    } catch (e) {
      setError(e instanceof ApiError ? e.fields.value ?? e.message : "Could not save the quote.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Provider quote" className="text-[13px]">
      <h2 className="mb-2 text-meta">Provider quote</h2>
      {existing && (
        <div className="mb-3 rounded-[8px] border border-hairline bg-group/60 px-3 py-2.5">
          <div className="text-label">
            <span className="tnum font-[590] text-figure">{fmtMoney(existing.quotedReceipt, existing.currency)}</span> from {routeName}
          </div>
          <p className="mt-1 leading-relaxed text-meta">
            {existing.sentence} Entered by {existing.byName}, {fmtStamp(existing.at)}.
          </p>
        </div>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {quotable.length > 1 && (
          <Select aria-label="Quoted route" value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
            {quotable.map((o) => (
              <option key={o.ruleId} value={o.ruleId}>
                {o.displayLabel}
              </option>
            ))}
          </Select>
        )}
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="quote-v" className="text-meta">
            {routeName} quote, {kind === "amount" ? option?.destCurrency ?? "MXN" : "rate"}
          </label>
          {option && option.sourceCurrency !== option.destCurrency && (
            <Segmented size="sm" label="Quote type" value={kind} onChange={setKind} options={[{ value: "amount", label: "Amount" }, { value: "rate", label: "Rate" }]} />
          )}
        </div>
        <input
          id="quote-v"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
          placeholder={kind === "amount" ? (existing ? "Update the quote" : "Amount the supplier receives") : "e.g. 16.8800"}
          aria-invalid={!!error || undefined}
          className={clsx(controlClass, "tnum")}
        />
        {error ? (
          <p role="alert" className="text-xs text-bad-text">{error}</p>
        ) : (
          <p className="text-xs text-meta">{kind === "rate" ? "A quoted rate is applied as quoted, with no second markup." : "Typed from the provider's screen before paying."}</p>
        )}
        <Button type="submit" size="sm" className="self-start" loading={busy} disabled={!value.trim()}>
          {existing ? "Save new quote" : "Save quote"}
        </Button>
      </form>
    </section>
  );
}
