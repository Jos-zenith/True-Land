"use client";

import * as RD from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { Calendar, ChevronRight, Plus, X } from "lucide-react";
import { useShell, type ComposerOptions } from "@/components/shell/shell-context";
import { Button, Kbd } from "@/components/ui/button";
import { Menu, MenuCheckItem, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tip } from "@/components/ui/overlay";
import { Segmented, Select, controlClass } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError } from "@/hooks/use-api";
import { rememberNickname, useNicknames } from "@/hooks/use-nicknames";
import { addDays, fmtDate, fmtMoney, fmtRate } from "@/lib/format";
import { PAYOUT_LABEL } from "@/lib/labels";
import { createCheckSchema, zodFieldErrors, type FieldErrors } from "@/lib/schemas";
import { supplierToken } from "@/lib/pseudonym";
import type { ExcludedRoute, RateSnapshot } from "@/engine/types";

type Currency = "MXN" | "USD";
type Payout = "spei_mxn" | "usd_account";
type Code = "SHA" | "OUR" | "BEN";

interface Preview {
  ok: boolean;
  fields: FieldErrors;
  rate: RateSnapshot | null;
  scheduleVersion: number;
  suggestedSend: string | null;
  grossAtMid: string | null;
  excluded: ExcludedRoute[];
  eligible: { ruleId: string; label: string }[];
  verdictKind: string | null;
}

const PRESETS = ["5000", "15000", "50000"];
const clean = (s: string) => s.replace(/[,\s]/g, "");
const pretty = (s: string, dp = 2) => {
  const c = clean(s);
  if (!/^\d+(\.\d+)?$/.test(c)) return s;
  return Number(c).toLocaleString("en-US", { maximumFractionDigits: dp });
};

export function Composer({ open, options, onOpenChange }: { open: boolean; options: ComposerOptions; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const toast = useToast();
  const { meta } = useShell();
  const { nameFor } = useNicknames();
  const editing = options.mode === "edit";
  const today = meta?.today ?? new Date().toISOString().slice(0, 10);

  const init = useCallback(() => {
    const p = options.prefill ?? {};
    return {
      nickname: p.nickname ?? "",
      invoiceAmount: p.invoiceAmount ? pretty(p.invoiceAmount) : "",
      invoiceCurrency: (p.invoiceCurrency ?? "MXN") as Currency,
      sendAmount: p.sendAmount ? pretty(p.sendAmount) : "",
      payBy: p.payBy ?? addDays(today, 4),
      payoutMethod: (p.payoutMethod ?? (p.invoiceCurrency === "USD" ? "usd_account" : "spei_mxn")) as Payout,
      providers: p.providers ?? ["bank_a", "fintech_b"],
      invoiceRef: p.invoiceRef ?? "",
      chargeCode: (p.chargeCode ?? "SHA") as Code,
    };
  }, [options.prefill, today]);

  const [f, setF] = useState(init);
  const [sendTouched, setSendTouched] = useState(false);
  const [showRef, setShowRef] = useState(false);
  const [quoteOn, setQuoteOn] = useState(false);
  const [quote, setQuote] = useState({ ruleId: "", kind: "amount" as "amount" | "rate", value: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"draft" | "compare" | null>(null);
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!open) return;
    const s = init();
    setF(s);
    setSendTouched(editing || !!options.prefill?.sendAmount);
    setShowRef(!!s.invoiceRef);
    setQuoteOn(false);
    setQuote({ ruleId: "", kind: "amount", value: "" });
    setErrors({});
    setPreview(null);
  }, [open, init, editing, options.prefill]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((cur) => ({ ...cur, [k]: v }));
    setErrors((e) => {
      const { [k as string]: _drop, _form, ...rest } = e;
      void _drop;
      void _form;
      return rest;
    });
  };

  const payload = useMemo(
    () => ({
      invoiceAmount: clean(f.invoiceAmount),
      invoiceCurrency: f.invoiceCurrency,
      sourceCountry: "US" as const,
      destCountry: "MX" as const,
      sourceCurrency: "USD" as const,
      sendAmount: clean(f.sendAmount),
      payBy: f.payBy,
      payoutMethod: f.payoutMethod,
      providers: f.providers,
      invoiceRef: f.invoiceRef.trim() || null,
      chargeCode: f.chargeCode,
    }),
    [f],
  );

  // Live server preview (debounced). Nothing is saved.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/checks/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (res.ok) setPreview(await res.json());
      } catch {
        /* preview is advisory */
      }
    }, 220);
    return () => clearTimeout(t);
  }, [payload, open]);

  // Keep "you plan to send" linked to the invoice until the user edits it.
  useEffect(() => {
    if (sendTouched) return;
    if (f.invoiceCurrency === "USD") {
      if (f.sendAmount !== f.invoiceAmount) setF((c) => ({ ...c, sendAmount: c.invoiceAmount }));
    } else if (preview?.suggestedSend && clean(f.sendAmount) !== preview.suggestedSend) {
      setF((c) => ({ ...c, sendAmount: pretty(preview.suggestedSend!) }));
    }
  }, [preview?.suggestedSend, f.invoiceAmount, f.invoiceCurrency, f.sendAmount, sendTouched]);

  // Default the quoted route to the first eligible one.
  useEffect(() => {
    if (preview?.eligible.length && !preview.eligible.find((e) => e.ruleId === quote.ruleId)) {
      setQuote((q) => ({ ...q, ruleId: preview.eligible[0].ruleId }));
    }
  }, [preview?.eligible, quote.ruleId]);

  const applyPreset = async (usd: string) => {
    setSendTouched(true);
    set("sendAmount", pretty(usd));
    if (f.invoiceCurrency === "USD") {
      set("invoiceAmount", pretty(usd));
      return;
    }
    // Ask the server for the gross peso value of this send at the sample rate (no client-side FX maths).
    try {
      const res = await fetch("/api/checks/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, sendAmount: usd, invoiceAmount: "1" }),
      });
      const p: Preview = await res.json();
      if (p.grossAtMid) set("invoiceAmount", pretty(p.grossAtMid, 2));
    } catch {
      /* leave invoice for the user */
    }
  };

  const setCurrency = (c: Currency) => {
    setF((cur) => ({
      ...cur,
      invoiceCurrency: c,
      payoutMethod: c === "USD" ? "usd_account" : "spei_mxn",
      providers: c === "USD" && !cur.providers.includes("bank_a") ? [...cur.providers, "bank_a"] : cur.providers,
    }));
    if (c === "USD") setSendTouched(false);
  };

  const focusFirst = (errs: FieldErrors) => {
    const order = ["nickname", "invoiceAmount", "sendAmount", "payBy", "providers", "payoutMethod", "invoiceRef", "quote"];
    const key = order.find((k) => errs[k] || (k === "quote" && errs["quote.value"]));
    if (key) requestAnimationFrame(() => refs.current[key]?.focus());
  };

  const submit = async (draft: boolean) => {
    const errs: FieldErrors = {};
    if (!editing && !f.nickname.trim()) errs.nickname = "Give the supplier a nickname. It stays on this device.";
    // Only an HMAC token of the nickname is sent (keyed per workspace). The nickname stays on this device.
    // When editing, the supplier cannot change, so a placeholder satisfies the shared schema and is not sent.
    const token = editing ? "0".repeat(64) : f.nickname.trim() && meta?.pseudonymKey ? supplierToken(meta.pseudonymKey, f.nickname) : "";
    const body = {
      ...payload,
      supplierToken: token,
      draft,
      quote: quoteOn && !draft && quote.value.trim() ? { ruleId: quote.ruleId, kind: quote.kind, value: clean(quote.value) } : null,
    };
    const parsed = createCheckSchema.safeParse(body);
    if (!parsed.success) Object.assign(errs, zodFieldErrors(parsed.error));
    if (errs.supplierToken) {
      errs.nickname ??= errs.supplierToken;
      delete errs.supplierToken;
    }
    if (f.payBy < today) errs.payBy = "Choose today or a later date.";
    if (Object.keys(errs).length) {
      setErrors(errs);
      focusFirst(errs);
      return;
    }
    setBusy(draft ? "draft" : "compare");
    try {
      if (editing && options.checkId) {
        const { supplierToken: _h, draft: _d, quote: _q, ...inputs } = body;
        void _h;
        void _d;
        void _q;
        await apiSend("PATCH", `/api/checks/${options.checkId}`, inputs);
        toast.success(`Inputs updated for ${options.checkId}. A new estimate was added; the old one is kept.`);
        onOpenChange(false);
        router.push(`/checks/${options.checkId}/compare`);
      } else {
        const res = await apiSend<{ id: string; calcError: unknown; supplierId: string }>("POST", "/api/checks", body);
        rememberNickname(res.supplierId, f.nickname);
        onOpenChange(false);
        if (draft) {
          toast.success(`Draft ${res.id} saved. Nothing was calculated yet.`);
          router.push(`/checks/${res.id}`);
        } else {
          toast.success(res.calcError ? `${res.id} saved, but the calculation failed. Inputs are kept.` : `${res.id} created and estimated. No money was sent.`);
          router.push(`/checks/${res.id}/compare`);
        }
      }
    } catch (e) {
      if (e instanceof ApiError) {
        const fe = { ...e.fields };
        if (fe.value) fe["quote.value"] = fe.value;
        if (!Object.keys(fe).length) fe._form = e.message;
        setErrors(fe);
        focusFirst(fe);
      } else setErrors({ _form: "Something went wrong. Nothing was saved." });
    } finally {
      setBusy(null);
    }
  };

  const providersLabel = f.providers.length
    ? f.providers.map((id) => meta?.providers.find((p) => p.id === id)?.name ?? id).join(", ")
    : "None";
  const excluded = preview?.excluded ?? [];
  const rate = preview?.rate ?? meta?.rate ?? null;
  const title = editing ? nameFor(options.prefill?.nickname ?? "") : f.nickname;

  return (
    <RD.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/65" />
        <RD.Content
          aria-describedby="composer-desc"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit(false);
            }
          }}
          className="fixed left-1/2 top-[6vh] z-50 flex max-h-[88vh] w-[calc(100vw-16px)] max-w-[760px] -translate-x-1/2 animate-pop-in flex-col rounded-[12px] border border-hairline-strong bg-raised shadow-[0_32px_80px_rgba(0,0,0,0.65)] sm:top-[12vh]"
        >
          <div className="flex items-center justify-between px-5 pt-4">
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className="inline-flex h-6 items-center gap-1.5 rounded-[6px] border border-hairline-strong px-1.5 text-label">
                <span className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-accent text-[9px] font-[650] text-white">N</span>
                {meta?.workspace.name ?? "Workspace"}
              </span>
              <ChevronRight size={13} className="text-meta" />
              <RD.Title className="font-[510] text-figure">{editing ? `Edit inputs · ${options.checkId}` : "New payment check"}</RD.Title>
            </div>
            <RD.Close aria-label="Close" className="rounded-[6px] p-1 text-meta hover:bg-hover hover:text-label">
              <X size={15} />
            </RD.Close>
          </div>

          <div className="overflow-y-auto px-5 pb-4 pt-3">
            {editing ? (
              <div className="text-[20px] font-[590] text-figure">{title}</div>
            ) : (
              <div>
                <input
                  ref={(el) => {
                    refs.current.nickname = el;
                  }}
                  autoFocus
                  value={f.nickname}
                  onChange={(e) => set("nickname", e.target.value)}
                  placeholder="Supplier nickname"
                  aria-label="Supplier nickname"
                  aria-invalid={!!errors.nickname || undefined}
                  maxLength={48}
                  className="w-full bg-transparent text-[20px] font-[590] text-figure placeholder:text-deco focus-visible:outline-none"
                />
                {errors.nickname && <p role="alert" className="mt-0.5 text-xs text-bad-text">{errors.nickname}</p>}
              </div>
            )}

            <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-[1fr_auto]">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-3">
                  <label htmlFor="cmp-invoice" className="shrink-0 text-[13px] text-meta">Invoice amount</label>
                  <div className={clsx("flex min-w-0 flex-1 items-baseline gap-2 border-b pb-0.5 transition-colors", errors.invoiceAmount ? "border-bad" : "border-control-soft focus-within:border-ring")}>
                    <span className="text-[22px] font-[590] text-figure">{f.invoiceCurrency}</span>
                    <input
                      id="cmp-invoice"
                      ref={(el) => {
                        refs.current.invoiceAmount = el;
                      }}
                      inputMode="decimal"
                      value={f.invoiceAmount}
                      onChange={(e) => set("invoiceAmount", e.target.value)}
                      onBlur={() => set("invoiceAmount", pretty(f.invoiceAmount))}
                      placeholder="0"
                      aria-invalid={!!errors.invoiceAmount || undefined}
                      className="figure min-w-0 flex-1 bg-transparent text-[22px] font-[590] text-figure placeholder:text-deco focus-visible:outline-none"
                    />
                  </div>
                </div>
                {errors.invoiceAmount && <p role="alert" className="text-xs text-bad-text">{errors.invoiceAmount}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <label htmlFor="cmp-send" className="shrink-0 text-[13px] text-meta">You plan to send</label>
                  <div className={clsx("flex items-baseline gap-1.5 border-b pb-0.5 transition-colors", errors.sendAmount ? "border-bad" : "border-control-soft focus-within:border-ring")}>
                    <span className="text-[16px] font-[590] text-figure">USD</span>
                    <input
                      id="cmp-send"
                      ref={(el) => {
                        refs.current.sendAmount = el;
                      }}
                      inputMode="decimal"
                      value={f.sendAmount}
                      onChange={(e) => {
                        setSendTouched(true);
                        set("sendAmount", e.target.value);
                      }}
                      onBlur={() => set("sendAmount", pretty(f.sendAmount))}
                      placeholder="0.00"
                      aria-invalid={!!errors.sendAmount || undefined}
                      className="figure w-[132px] bg-transparent text-[16px] font-[590] text-figure placeholder:text-deco focus-visible:outline-none"
                    />
                  </div>
                </div>
                {errors.sendAmount && <p role="alert" className="text-xs text-bad-text">{errors.sendAmount}</p>}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-meta">Typical tickets</span>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={clsx(
                    "tnum h-6 rounded-full border px-2.5 text-xs font-[510] transition-colors",
                    clean(f.sendAmount) === p ? "border-accent bg-accent-soft text-figure" : "border-hairline-strong text-label hover:bg-hover",
                  )}
                >
                  ${Number(p).toLocaleString("en-US")}
                </button>
              ))}
            </div>

            <p id="composer-desc" className="mt-3 text-[13px] leading-relaxed text-meta">
              {rate && f.invoiceCurrency === "MXN" && preview?.grossAtMid ? (
                <>
                  At the {rate.isDemo ? "sample" : rate.classification === "published" ? "reference" : "entered"} rate {fmtRate(rate.rate)}, {fmtMoney(clean(f.sendAmount), "USD")} is {fmtMoney(preview.grossAtMid, "MXN")} before any cost.{" "}
                </>
              ) : f.invoiceCurrency === "USD" ? (
                <>A dollar invoice paid by USD wire: we check whether the full amount is likely to arrive. </>
              ) : rate ? (
                <>Enter the invoice in pesos; we suggest the dollars to send at the {rate.isDemo ? "sample" : rate.classification === "published" ? "reference" : "entered"} rate {fmtRate(rate.rate)}. </>
              ) : (
                <>No exchange rate is available; enter one in Data sources. </>
              )}
              {!editing && "The nickname stays on this device; records use a hashed supplier ID."}
            </p>

            {/* Property chips */}
            <div className="mt-3.5 flex flex-wrap gap-1.5">
              <Menu>
                <MenuTrigger asChild>
                  <PropChip label="Invoice in" value={f.invoiceCurrency} />
                </MenuTrigger>
                <MenuContent align="start">
                  <MenuLabel>Invoice currency</MenuLabel>
                  <MenuItem onSelect={() => setCurrency("MXN")}>MXN · Mexican peso</MenuItem>
                  <MenuItem onSelect={() => setCurrency("USD")}>USD · US dollar</MenuItem>
                </MenuContent>
              </Menu>
              <Tip content="You can only pay in USD from the United States in this release.">
                <span tabIndex={0} className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-hairline-strong px-2 text-[13px] text-meta">
                  You pay in <span className="font-[510] text-figure">USD</span>
                </span>
              </Tip>
              <Menu>
                <MenuTrigger asChild>
                  <PropChip label="" value="United States → Mexico" />
                </MenuTrigger>
                <MenuContent align="start" className="w-[280px]">
                  <MenuLabel>Corridor</MenuLabel>
                  <MenuItem onSelect={() => {}}>United States → Mexico</MenuItem>
                  <MenuItem disabled>United States → India · control corridor, test fixture only</MenuItem>
                </MenuContent>
              </Menu>
              <Popover>
                <PopoverTrigger asChild>
                  <PropChip label="Pay by" value={fmtDate(f.payBy)} invalid={!!errors.payBy} icon={<Calendar size={13} className="text-meta" />} chipRef={(el) => { refs.current.payBy = el; }} />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[260px]">
                  <label htmlFor="cmp-payby" className="text-xs text-meta">Must arrive by</label>
                  <input
                    id="cmp-payby"
                    type="date"
                    min={today}
                    value={f.payBy}
                    onChange={(e) => set("payBy", e.target.value)}
                    aria-invalid={!!errors.payBy || undefined}
                    className={clsx(controlClass, "tnum mt-1.5")}
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {[
                      ["Tomorrow", 1],
                      ["In 2 days", 2],
                      ["In 4 days", 4],
                      ["In a week", 7],
                    ].map(([l, d]) => (
                      <button key={l} type="button" onClick={() => set("payBy", addDays(today, d as number))} className="h-6 rounded-[5px] border border-hairline-strong px-2 text-xs text-label hover:bg-hover">
                        {l}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Menu>
                <MenuTrigger asChild>
                  <PropChip label="Providers" value={providersLabel} invalid={!!errors.providers} chipRef={(el) => { refs.current.providers = el; }} />
                </MenuTrigger>
                <MenuContent align="start" className="w-[260px]">
                  <MenuLabel>Accounts you hold</MenuLabel>
                  {meta?.providers.map((p) => (
                    <MenuCheckItem
                      key={p.id}
                      checked={f.providers.includes(p.id)}
                      onCheckedChange={(v) => set("providers", v ? [...f.providers, p.id] : f.providers.filter((x) => x !== p.id))}
                    >
                      {p.name} <span className="text-meta">· {p.kind}</span>
                    </MenuCheckItem>
                  ))}
                  <MenuSeparator />
                  <p className="px-2 py-1 text-xs text-meta">We only compare routes you can actually use. Nothing is connected to these providers.</p>
                </MenuContent>
              </Menu>
              <Menu>
                <MenuTrigger asChild>
                  <PropChip label="Supplier receives" value={PAYOUT_LABEL[f.payoutMethod]} />
                </MenuTrigger>
                <MenuContent align="start">
                  <MenuLabel>How the supplier is paid</MenuLabel>
                  <MenuItem onSelect={() => set("payoutMethod", "spei_mxn")}>Pesos by SPEI</MenuItem>
                  <MenuItem onSelect={() => set("payoutMethod", "usd_account")}>US dollars to a USD account</MenuItem>
                </MenuContent>
              </Menu>
              {f.invoiceCurrency === "USD" && (
                <Menu>
                  <MenuTrigger asChild>
                    <PropChip label="Planned charge code" value={f.chargeCode} />
                  </MenuTrigger>
                  <MenuContent align="start" className="w-[300px]">
                    <MenuLabel>Wire charge code</MenuLabel>
                    <MenuItem onSelect={() => set("chargeCode", "SHA")}>SHA · charges shared</MenuItem>
                    <MenuItem onSelect={() => set("chargeCode", "OUR")}>OUR · you pay all charges</MenuItem>
                    <MenuItem onSelect={() => set("chargeCode", "BEN")}>BEN · supplier pays all charges</MenuItem>
                  </MenuContent>
                </Menu>
              )}
              {!showRef && (
                <button type="button" onClick={() => setShowRef(true)} className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-dashed border-hairline-strong px-2 text-[13px] text-meta hover:bg-hover hover:text-label">
                  <Plus size={13} /> Invoice reference
                </button>
              )}
              {!quoteOn && !editing && (
                <button type="button" onClick={() => setQuoteOn(true)} className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-dashed border-hairline-strong px-2 text-[13px] text-meta hover:bg-hover hover:text-label">
                  <Plus size={13} /> Provider quote
                </button>
              )}
            </div>
            {errors.payBy && <p role="alert" className="mt-1.5 text-xs text-bad-text">Pay by: {errors.payBy}</p>}
            {errors.providers && <p role="alert" className="mt-1.5 text-xs text-bad-text">{errors.providers}</p>}

            {(showRef || quoteOn) && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {showRef && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="cmp-ref" className="text-[13px] text-meta">Invoice reference <span className="text-meta/80">· optional</span></label>
                    <input
                      id="cmp-ref"
                      ref={(el) => {
                        refs.current.invoiceRef = el;
                      }}
                      value={f.invoiceRef}
                      onChange={(e) => set("invoiceRef", e.target.value)}
                      placeholder="INV-2381"
                      maxLength={40}
                      aria-invalid={!!errors.invoiceRef || undefined}
                      className={controlClass}
                    />
                    {errors.invoiceRef ? <p className="text-xs text-bad-text">{errors.invoiceRef}</p> : <p className="text-xs text-meta">No personal data, please.</p>}
                  </div>
                )}
                {quoteOn && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="cmp-quote" className="text-[13px] text-meta">Existing provider quote <span className="text-meta/80">· optional</span></label>
                      <button type="button" onClick={() => setQuoteOn(false)} className="text-xs text-meta hover:text-label">Remove</button>
                    </div>
                    <div className="flex gap-1.5">
                      <Select aria-label="Quoted route" value={quote.ruleId} onChange={(e) => setQuote({ ...quote, ruleId: e.target.value })} className="w-[150px]">
                        {(preview?.eligible ?? []).map((e) => (
                          <option key={e.ruleId} value={e.ruleId}>{e.label}</option>
                        ))}
                      </Select>
                      <Segmented size="sm" label="Quote type" value={quote.kind} onChange={(v) => setQuote({ ...quote, kind: v })} options={[{ value: "amount", label: "Amount" }, { value: "rate", label: "Rate" }]} className="h-9 items-center" />
                    </div>
                    <input
                      id="cmp-quote"
                      ref={(el) => {
                        refs.current.quote = el;
                      }}
                      inputMode="decimal"
                      value={quote.value}
                      onChange={(e) => setQuote({ ...quote, value: e.target.value })}
                      placeholder={quote.kind === "amount" ? `Amount the supplier receives, ${f.invoiceCurrency}` : "Quoted rate, MXN per USD"}
                      aria-invalid={!!errors["quote.value"] || undefined}
                      className={clsx(controlClass, "tnum")}
                    />
                    {errors["quote.value"] ? <p className="text-xs text-bad-text">{errors["quote.value"]}</p> : <p className="text-xs text-meta">Typed from the provider&apos;s screen. Stored as a provider quote, never as our estimate.</p>}
                  </div>
                )}
              </div>
            )}

            {(excluded.length > 0 || preview?.verdictKind === "none_eligible") && (
              <div className="mt-3.5 space-y-1 text-[13px] text-meta">
                {preview?.verdictKind === "none_eligible" && (
                  <p className="text-label">
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-bad align-middle" />
                    No eligible route with these inputs. You can still save the check; change the deadline or providers to compare.
                  </p>
                )}
                {excluded.length > 0 && <p>Unavailable: {excluded.map((x) => `${x.label}, ${x.reason}`).join(" · ")}.</p>}
              </div>
            )}
            {errors._form && (
              <p role="alert" className="mt-3 text-[13px] text-bad-text">
                {errors._form}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-3">
            <span className="text-xs text-meta">United States to Mexico only · We never move money</span>
            <div className="ml-auto flex items-center gap-2">
              {!editing && (
                <Button variant="ghost" onClick={() => submit(true)} loading={busy === "draft"} disabled={!!busy}>
                  Save draft
                </Button>
              )}
              <RD.Close asChild>
                <Button disabled={!!busy}>Cancel</Button>
              </RD.Close>
              <Button variant="primary" onClick={() => submit(false)} loading={busy === "compare"} disabled={!!busy}>
                {editing ? "Recalculate" : "Compare routes"}
              </Button>
            </div>
          </div>
        </RD.Content>
        {open && (
          <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 hidden -translate-x-1/2 items-center gap-1.5 text-xs text-meta sm:flex">
            <Kbd>Esc</Kbd> closes · <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd> {editing ? "recalculates" : "compares"}
          </div>
        )}
      </RD.Portal>
    </RD.Root>
  );
}

const PropChip = forwardRef<
  HTMLButtonElement,
  { label: string; value: ReactNode; invalid?: boolean; icon?: ReactNode; chipRef?: (el: HTMLButtonElement | null) => void } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function PropChip({ label, value, invalid, icon, chipRef, className, ...rest }, ref) {
  return (
    <button
      type="button"
      ref={(el) => {
        chipRef?.(el);
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      {...rest}
      className={clsx(
        "inline-flex h-7 max-w-full items-center gap-1 rounded-[7px] border px-2 text-[13px] text-meta transition-colors hover:bg-hover",
        invalid ? "border-bad" : "border-hairline-strong",
        className,
      )}
    >
      {icon}
      {label && <span>{label}</span>}
      <span className="truncate font-[510] text-figure">{value}</span>
    </button>
  );
});
