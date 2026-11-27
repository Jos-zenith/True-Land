"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { Button } from "@/components/ui/button";
import { ErrorState, Notice, SkeletonRows } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog, Sheet, Tip } from "@/components/ui/overlay";
import { SourceBadge } from "@/components/ui/chip";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError, useApi } from "@/hooks/use-api";
import { fmtDate, fmtMoney, fmtNum, fmtStamp } from "@/lib/format";
import { feeRuleSchema, zodFieldErrors } from "@/lib/schemas";
import type { FeeRule, Triple } from "@/engine/types";

interface FeesState {
  current: { version: number; publishedAt: string; rules: FeeRule[] };
  draft: { basedOn: number; rules: FeeRule[]; updatedAt: string };
  hasDraft: boolean;
  preview: {
    draftVersion: number;
    reference: string;
    changes: { ruleId: string; label: string; changes: string[]; before: { typical: string; low: string | null; high: string; currency: string } | null; after: { typical: string; low: string | null; high: string; currency: string } | null }[];
  };
  versions: { version: number; publishedAt: string; publishedByName: string; note: string; ruleCount: number }[];
  providers: { id: string; name: string; kind: string }[];
  canEdit: boolean;
}

const blankTriple: Triple = { low: "", typical: "", high: "" };

export default function FeesPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<FeesState>("/api/fees");
  const [rules, setRules] = useState<FeeRule[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ open: boolean; rule: FeeRule | null; isNew: boolean }>({ open: false, rule: null, isNew: false });
  const [publish, setPublish] = useState(false);
  const [disable, setDisable] = useState<FeeRule | null>(null);

  useEffect(() => {
    if (data && !dirty) setRules(structuredClone(data.draft.rules));
  }, [data, dirty]);

  const update = (id: string, patch: Partial<FeeRule>) => {
    setRules((rs) => rs!.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const save = async (next = rules) => {
    if (!next) return false;
    const errs: Record<string, string> = {};
    next.forEach((r) => {
      const p = feeRuleSchema.safeParse(r);
      if (!p.success) for (const [k, v] of Object.entries(zodFieldErrors(p.error))) errs[`${r.id}.${k}`] = v;
    });
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Some values need attention before the draft can be saved.");
      return false;
    }
    setBusy("save");
    try {
      await apiSend("PUT", "/api/fees", { rules: next });
      setDirty(false);
      toast.success("Draft saved. Nothing changes until it is published.");
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save the draft.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setBusy("discard");
    try {
      await apiSend("DELETE", "/api/fees");
      setDirty(false);
      setErrors({});
      toast.success("Draft discarded.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not discard the draft.");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <><PageHeader crumbs={[{ label: "Fee configuration" }]} /><ErrorState message={error.message} onRetry={reload} /></>;
  if (loading || !data || !rules) return <><PageHeader crumbs={[{ label: "Fee configuration" }]} /><SkeletonRows rows={8} /></>;

  const changes = data.preview.changes;
  const pending = dirty || data.hasDraft;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Fee configuration" }]}
        actions={
          data.canEdit && (
            <>
              {pending && (
                <Button variant="ghost" onClick={discard} loading={busy === "discard"} disabled={!!busy}>
                  Discard
                </Button>
              )}
              {dirty && (
                <Button onClick={() => save()} loading={busy === "save"} disabled={!!busy}>
                  Save draft
                </Button>
              )}
              <Button
                variant="primary"
                disabled={!!busy || (!dirty && changes.length === 0)}
                onClick={async () => {
                  if (dirty && !(await save())) return;
                  setPublish(true);
                }}
              >
                Publish v{data.preview.draftVersion}
              </Button>
            </>
          )
        }
      >
        <span className="text-[13px] text-meta">{pending ? `editing a draft of v${data.preview.draftVersion}` : `v${data.current.version} published ${fmtDate(data.current.publishedAt)}`}</span>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-5 md:px-6">
          <Notice title="Manually configured assumptions">
            Every rule here is a demo assumption entered by hand and classified “Modelled”. None comes from a provider feed. Blank means unknown: estimates for that route become rough. Saved checks keep the version they were computed with.
          </Notice>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1080px] text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-left text-meta">
                <th className="px-4 py-2 font-[510] md:pl-6">Route</th>
                <th className="px-2 py-2 font-[510]">Sender fee USD</th>
                <th className="px-2 py-2 font-[510]">Markup % low / typical / high</th>
                <th className="px-2 py-2 font-[510]">Deduction USD low / typical / high</th>
                <th className="px-2 py-2 font-[510]">Receiving fee</th>
                <th className="px-2 py-2 font-[510]">Eligibility</th>
                <th className="px-2 py-2 font-[510]">Last verified</th>
                <th className="w-10 pr-4 md:pr-6" aria-label="Edit" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const err = (k: string) => errors[`${r.id}.${k}`];
                const changed = changes.find((c) => c.ruleId === r.id);
                return (
                  <tr key={r.id} className={clsx("border-b border-hairline align-top", r.eligibility === "disabled" && "opacity-55")}>
                    <td className="px-4 py-2.5 md:pl-6">
                      <div className="flex items-center gap-1.5 font-[510] text-figure">
                        {r.routeName}
                        {r.optionLabel && <span className="text-meta">{r.optionLabel}</span>}
                        {changed && !dirty && <span className="rounded-[4px] bg-accent-soft px-1.5 text-[11px] text-[#b4bbff]">changed</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-meta">
                        {r.sourceCurrency} → {r.destCurrency} · {r.speedLabel} · <SourceBadge cls={r.classification} compact /> manual
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <NumCell label={`${r.routeName} sender fee`} value={r.senderFee} disabled={!data.canEdit} error={err("senderFee")} onChange={(v) => update(r.id, { senderFee: v })} />
                    </td>
                    <td className="px-2 py-2">
                      {r.method === "usd_wire" ? (
                        <span className="text-xs text-meta">no conversion</span>
                      ) : (
                        <TripleCell label={`${r.routeName} markup`} value={r.markupPct} disabled={!data.canEdit} error={err("markupPct")} onChange={(v) => update(r.id, { markupPct: v })} />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <TripleCell label={`${r.routeName} deduction`} value={r.deduction} disabled={!data.canEdit} error={err("deduction")} onChange={(v) => update(r.id, { deduction: v })} />
                    </td>
                    <td className="px-2 py-2">
                      <NumCell label={`${r.routeName} receiving fee`} value={r.receivingFee} suffix={r.destCurrency} disabled={!data.canEdit} error={err("receivingFee")} onChange={(v) => update(r.id, { receivingFee: v })} />
                    </td>
                    <td className="px-2 py-2">
                      <Select aria-label={`${r.routeName} eligibility`} disabled={!data.canEdit} value={r.eligibility} onChange={(e) => (e.target.value === "disabled" ? setDisable(r) : update(r.id, { eligibility: e.target.value as FeeRule["eligibility"] }))} className="h-8 w-[136px]">
                        <option value="approved">Approved</option>
                        <option value="unverified">Unverified</option>
                        <option value="disabled">Disabled</option>
                      </Select>
                    </td>
                    <td className="tnum px-2 py-3 text-meta">{fmtDate(r.lastVerifiedAt)}</td>
                    <td className="py-2 pr-4 md:pr-6">
                      {data.canEdit && (
                        <Tip content="Edit all fields">
                          <button aria-label={`Edit ${r.routeName}`} onClick={() => setEdit({ open: true, rule: structuredClone(r), isNew: false })} className="flex h-8 w-8 items-center justify-center rounded-[6px] text-meta hover:bg-hover hover:text-label">
                            <Pencil size={14} />
                          </button>
                        </Tip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.canEdit && (
          <div className="px-4 pt-3 md:px-6">
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setEdit({ open: true, rule: newRule(data.providers[0]?.id ?? "bank_a", data.providers, rules), isNew: true })}>
              Add fee rule
            </Button>
          </div>
        )}

        <div className="grid gap-6 px-4 pb-12 pt-7 md:px-6 xl:grid-cols-2">
          <section className="rounded-[9px] border border-hairline px-5 py-4" aria-label="Effect of the draft">
            <h2 className="text-[13px] font-[590] text-figure">Effect of the draft on {data.preview.reference}</h2>
            {dirty ? (
              <p className="mt-2 text-[13px] text-meta">Save the draft to preview its effect.</p>
            ) : changes.length === 0 ? (
              <p className="mt-2 text-[13px] text-meta">No changes against v{data.current.version}.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2 text-[13px]">
                {changes.map((c) => (
                  <li key={c.ruleId}>
                    <span className="font-[510] text-label">{c.label}</span> <span className="text-meta">({c.changes.join(", ")})</span>
                    <div className="tnum text-meta">
                      Typical: v{data.current.version} {c.before ? fmtMoney(c.before.typical, c.before.currency) : "not estimated"} → draft {c.after ? fmtMoney(c.after.typical, c.after.currency) : "not estimated"}
                      {c.before && c.after && c.before.typical === c.after.typical && " (no change)"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-meta">Saved checks keep the version they were computed with. Nothing is recalculated in the past.</p>
          </section>
          <section className="rounded-[9px] border border-hairline px-5 py-4" aria-label="Change history">
            <h2 className="text-[13px] font-[590] text-figure">Change history</h2>
            <ol className="mt-2 flex flex-col gap-1.5 text-[13px]">
              {data.versions.map((v) => (
                <li key={v.version} className="text-meta">
                  <span className="font-[510] text-label">v{v.version}</span> · {fmtStamp(v.publishedAt)} · {v.publishedByName}: {v.note}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      <RuleSheet
        state={edit}
        providers={data.providers}
        onClose={() => setEdit({ open: false, rule: null, isNew: false })}
        onSave={(rule) => {
          const next = edit.isNew ? [...rules, rule] : rules.map((r) => (r.id === rule.id ? rule : r));
          setRules(next);
          setDirty(true);
          setEdit({ open: false, rule: null, isNew: false });
          void save(next);
        }}
      />
      <Dialog
        open={!!disable}
        onOpenChange={(o) => !o && setDisable(null)}
        title={`Disable ${disable?.routeName ?? "this rule"}?`}
        description="Disabled routes are excluded from new estimates with the reason “disabled in fee configuration”. Existing checks are unchanged. This takes effect only when the draft is published."
        footer={
          <>
            <Button onClick={() => setDisable(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                update(disable!.id, { eligibility: "disabled" });
                setDisable(null);
              }}
            >
              Disable in draft
            </Button>
          </>
        }
      />
      <PublishDialog open={publish} onOpenChange={setPublish} version={data.preview.draftVersion} changes={changes} />
    </>
  );
}

function NumCell({ value, onChange, label, error, suffix, disabled }: { value: string | null; onChange: (v: string | null) => void; label: string; error?: string; suffix?: string; disabled?: boolean }) {
  return (
    <div>
      <div className={clsx("relative", suffix ? "w-[116px]" : "w-[88px]")}>
        <input
          aria-label={label}
          disabled={disabled}
          inputMode="decimal"
          value={value ?? ""}
          placeholder="unknown"
          title={value === null ? "Unknown: estimates for this route become rough" : undefined}
          onChange={(e) => onChange(e.target.value.trim() === "" ? null : e.target.value.trim())}
          aria-invalid={!!error || undefined}
          className={clsx(
            "tnum h-8 w-full rounded-[6px] border bg-panel px-2 text-[13px] text-figure placeholder:text-warn/80 focus-visible:border-ring focus-visible:outline-none disabled:opacity-60",
            error ? "border-bad" : "border-control-soft hover:border-control",
            suffix && "pr-10",
          )}
        />
        {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-meta">{suffix}</span>}
      </div>
      {error && <p className="mt-1 max-w-[180px] text-xs text-bad-text">{error}</p>}
    </div>
  );
}

function TripleCell({ value, onChange, label, error, disabled }: { value: Triple | null; onChange: (v: Triple | null) => void; label: string; error?: string; disabled?: boolean }) {
  const v = value ?? blankTriple;
  const set = (k: keyof Triple, s: string) => {
    const next = { ...v, [k]: s.trim() };
    onChange(next.low === "" && next.typical === "" && next.high === "" ? null : next);
  };
  return (
    <div>
      <div className={clsx("inline-flex h-8 items-center rounded-[6px] border bg-panel", error ? "border-bad" : "border-control-soft hover:border-control focus-within:border-ring")}>
        {(["low", "typical", "high"] as const).map((k, i) => (
          <span key={k} className="flex items-center">
            {i > 0 && <span className="text-deco">/</span>}
            <input
              aria-label={`${label}, ${k} case`}
              disabled={disabled}
              inputMode="decimal"
              value={v[k]}
              placeholder="?"
              onChange={(e) => set(k, e.target.value)}
              className="tnum h-full w-[46px] bg-transparent px-1.5 text-center text-[13px] text-figure placeholder:text-warn/80 focus-visible:outline-none disabled:opacity-60"
            />
          </span>
        ))}
      </div>
      {error && <p className="mt-1 max-w-[220px] text-xs text-bad-text">{error}</p>}
    </div>
  );
}

function newRule(providerId: string, providers: FeesState["providers"], rules: FeeRule[]): FeeRule {
  const n = rules.length + 1;
  const p = providers.find((x) => x.id === providerId);
  const now = new Date().toISOString();
  return {
    id: `${providerId}_mxn_${n}`,
    routeId: `${providerId}_mxn_${n}`,
    providerId,
    providerName: p?.name ?? providerId,
    routeName: `${p?.name ?? "Provider"}, peso payout`,
    optionLabel: null,
    method: "local_payout",
    sourceCurrency: "USD",
    destCurrency: "MXN",
    invoiceCurrencies: ["MXN"],
    payoutMethod: "spei_mxn",
    chargeCode: null,
    senderFee: null,
    markupPct: null,
    deduction: { low: "0", typical: "0", high: "0" },
    receivingFee: null,
    feePayer: "sender",
    minAmount: "1",
    maxAmount: "100000",
    speedDays: { min: 0, max: 1 },
    speedLabel: "same or next day",
    eligibility: "unverified",
    eligibilityNote: "awaiting counsel review",
    source: "Draft",
    classification: "modelled",
    lastVerifiedAt: now,
    effectiveFrom: now.slice(0, 10),
  };
}

function RuleSheet({ state, providers, onClose, onSave }: { state: { open: boolean; rule: FeeRule | null; isNew: boolean }; providers: FeesState["providers"]; onClose: () => void; onSave: (r: FeeRule) => void }) {
  const [r, setR] = useState<FeeRule | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setR(state.rule ? structuredClone(state.rule) : null);
    setErrs({});
    setConfirm(false);
  }, [state.rule]);
  const set = (p: Partial<FeeRule>) => setR((x) => (x ? { ...x, ...p } : x));
  const usd = r?.method === "usd_wire";
  const validate = () => {
    if (!r) return false;
    const p = feeRuleSchema.safeParse(r);
    if (!p.success) {
      setErrs(zodFieldErrors(p.error));
      return false;
    }
    setErrs({});
    return true;
  };
  const triple = (key: "markupPct" | "deduction", label: string) => {
    const v = r?.[key] ?? blankTriple;
    return (
      <Field label={label} error={errs[key]}>
        <div className="grid grid-cols-3 gap-1.5">
          {(["low", "typical", "high"] as const).map((k) => (
            <Input
              key={k}
              aria-label={`${label}, ${k}`}
              inputMode="decimal"
              className="tnum"
              placeholder={k}
              value={v[k]}
              onChange={(e) => {
                const next = { ...v, [k]: e.target.value.trim() };
                set({ [key]: next.low === "" && next.typical === "" && next.high === "" ? null : next } as Partial<FeeRule>);
              }}
            />
          ))}
        </div>
      </Field>
    );
  };
  return (
    <Sheet
      open={state.open}
      onOpenChange={(o) => !o && onClose()}
      width={440}
      title={state.isNew ? "Add fee rule" : `Edit ${state.rule?.routeName ?? "rule"}`}
      description="Changes go into the draft. Nothing affects estimates until the draft is published."
      footer={
        confirm ? (
          <>
            <span className="mr-auto text-xs text-meta">Save these values to the draft?</span>
            <Button onClick={() => setConfirm(false)}>Back</Button>
            <Button variant="primary" onClick={() => r && onSave(r)}>
              Confirm
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => validate() && setConfirm(true)}>
              Save to draft
            </Button>
          </>
        )
      }
    >
      {r && (
        <div className="flex flex-col gap-3.5">
          <Field label="Provider" htmlFor="rs-prov">
            <Select id="rs-prov" value={r.providerId} disabled={!state.isNew} onChange={(e) => set({ providerId: e.target.value, providerName: providers.find((p) => p.id === e.target.value)?.name ?? e.target.value })}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.kind}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Route name" htmlFor="rs-name" error={errs.routeName}>
            <Input id="rs-name" ref={first} value={r.routeName} onChange={(e) => set({ routeName: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Method" htmlFor="rs-m" error={errs.destCurrency}>
              <Select
                id="rs-m"
                value={r.method}
                disabled={!state.isNew}
                onChange={(e) => {
                  const m = e.target.value as FeeRule["method"];
                  set(m === "usd_wire" ? { method: m, destCurrency: "USD", invoiceCurrencies: ["USD"], payoutMethod: "usd_account", markupPct: { low: "0", typical: "0", high: "0" } } : { method: m, destCurrency: "MXN", invoiceCurrencies: ["MXN"], payoutMethod: "spei_mxn" });
                }}
              >
                <option value="local_payout">Local peso payout</option>
                <option value="bank_fx_wire">Bank wire to pesos</option>
                <option value="usd_wire">USD wire</option>
              </Select>
            </Field>
            <Field label="Fee payer" htmlFor="rs-fp">
              <Select id="rs-fp" value={r.feePayer} onChange={(e) => set({ feePayer: e.target.value as FeeRule["feePayer"] })}>
                <option value="sender">Sender</option>
                <option value="shared">Shared (SHA)</option>
                <option value="beneficiary">Beneficiary (BEN)</option>
              </Select>
            </Field>
          </div>
          <div className="text-xs text-meta">
            Currencies: {r.sourceCurrency} → {r.destCurrency}. Fees in USD except the receiving fee, which is in {r.destCurrency}.
          </div>
          <Field label="Sending fee, USD, paid on top" htmlFor="rs-sf" error={errs.senderFee} hint="Leave blank if unknown.">
            <Input id="rs-sf" inputMode="decimal" className="tnum" value={r.senderFee ?? ""} onChange={(e) => set({ senderFee: e.target.value.trim() || null })} />
          </Field>
          {!usd && triple("markupPct", "FX markup %, low / typical / high result")}
          {triple("deduction", "Intermediary deduction USD, low / typical / high result")}
          <Field label={`Receiving fee, ${r.destCurrency}`} htmlFor="rs-rf" error={errs.receivingFee} hint="Leave blank if unknown: estimates become rough.">
            <Input id="rs-rf" inputMode="decimal" className="tnum" value={r.receivingFee ?? ""} onChange={(e) => set({ receivingFee: e.target.value.trim() || null })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum USD" htmlFor="rs-min" error={errs.minAmount}>
              <Input id="rs-min" inputMode="decimal" className="tnum" value={r.minAmount ?? ""} onChange={(e) => set({ minAmount: e.target.value.trim() || null })} />
            </Field>
            <Field label="Maximum USD" htmlFor="rs-max" error={errs.maxAmount}>
              <Input id="rs-max" inputMode="decimal" className="tnum" value={r.maxAmount ?? ""} onChange={(e) => set({ maxAmount: e.target.value.trim() || null })} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Fastest, days" htmlFor="rs-s1" error={errs.speedDays}>
              <Input id="rs-s1" type="number" min={0} max={10} className="tnum" value={r.speedDays.min} onChange={(e) => set({ speedDays: { ...r.speedDays, min: Number(e.target.value) } })} />
            </Field>
            <Field label="Slowest, days" htmlFor="rs-s2">
              <Input id="rs-s2" type="number" min={0} max={10} className="tnum" value={r.speedDays.max} onChange={(e) => set({ speedDays: { ...r.speedDays, max: Number(e.target.value) } })} />
            </Field>
            <Field label="Speed label" htmlFor="rs-sl">
              <Input id="rs-sl" value={r.speedLabel} onChange={(e) => set({ speedLabel: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Eligibility" htmlFor="rs-el">
              <Select id="rs-el" value={r.eligibility} onChange={(e) => set({ eligibility: e.target.value as FeeRule["eligibility"] })}>
                <option value="approved">Approved</option>
                <option value="unverified">Unverified</option>
                <option value="disabled">Disabled</option>
              </Select>
            </Field>
            <Field label="Effective date" htmlFor="rs-eff" error={errs.effectiveFrom}>
              <Input id="rs-eff" type="date" className="tnum" value={r.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />
            </Field>
          </div>
          <Field label="Eligibility note" htmlFor="rs-en" error={errs.eligibilityNote}>
            <Textarea id="rs-en" className="min-h-[56px]" value={r.eligibilityNote} onChange={(e) => set({ eligibilityNote: e.target.value })} maxLength={160} />
          </Field>
          <Field label="Evidence classification" htmlFor="rs-cl">
            <Select id="rs-cl" value={r.classification} onChange={(e) => set({ classification: e.target.value as FeeRule["classification"] })}>
              <option value="modelled">Modelled (assumption)</option>
              <option value="manual">Manually entered</option>
              <option value="published">Published schedule (only if you hold the document)</option>
            </Select>
          </Field>
          <p className="text-xs text-meta">
            Data source on publish: Fee schedule (next version). Last verified is set to the publish time for changed rules. Currently {fmtStamp(r.lastVerifiedAt)}.
          </p>
          {errs._form && <p className="text-xs text-bad-text">{errs._form}</p>}
        </div>
      )}
    </Sheet>
  );
}

function PublishDialog({ open, onOpenChange, version, changes }: { open: boolean; onOpenChange: (o: boolean) => void; version: number; changes: FeesState["preview"]["changes"] }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const summary = useMemo(() => changes.map((c) => `${c.label}: ${c.changes.join(", ")}`).join("; "), [changes]);
  useEffect(() => {
    if (open) {
      setNote("");
      setErr("");
    }
  }, [open]);
  const go = async () => {
    setBusy(true);
    try {
      await apiSend("POST", "/api/fees/publish", { note });
      toast.success(`Fee schedule v${version} published. New checks use it; saved checks keep their version.`);
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.fields?.note ?? e.message : "Could not publish.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={480}
      title={`Publish fee schedule v${version}?`}
      description="New estimates will use these assumptions. Existing checks keep the version they were computed with; nothing is recalculated."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={go}>
            Publish v{version}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="rounded-[8px] border border-hairline bg-panel px-3 py-2.5 text-[13px] text-meta">{summary || "No changes."}</div>
        <Field label="What changed and why" htmlFor="pub-note" error={err}>
          <Input id="pub-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fintech B markup confirmed with their pricing page" maxLength={200} invalid={!!err} />
        </Field>
        <p className="text-xs text-meta">{fmtNum(changes.length)} rule{changes.length === 1 ? "" : "s"} changed.</p>
      </div>
    </Dialog>
  );
}
