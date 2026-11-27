"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { SectionTitle } from "@/components/ui/layout";
import { useToast } from "@/components/ui/toast";
import { useShell } from "@/components/shell/shell-context";
import { apiSend, ApiError, useApi } from "@/hooks/use-api";
import { fmtPct, fmtRate, fmtStamp } from "@/lib/format";

export interface SnapshotView {
  id: string;
  base: string;
  quote: string;
  selectedRate: string | null;
  selectedProvider: string | null;
  secondaryRate: string | null;
  secondaryProvider: string | null;
  differencePercentage: string | null;
  observedAt: string | null;
  retrievedAt: string | null;
  freshness: "fresh" | "aging" | "stale" | "unavailable";
  fallbackUsed: boolean;
  warnings: string[];
  policyVersion: string;
  createdAt: string;
  evidence: { observationId: string; provider: string; usable: boolean; rate: string | null; freshness: string; observedAt: string | null; retrievedAt: string; reason: string | null; attribution: string | null; rawResponseHash: string | null; cached: boolean }[];
}

const NAME: Record<string, string> = { frankfurter: "Frankfurter", currencyapi: "currencyapi.com" };
const FRESH_TONE: Record<string, string> = { fresh: "bg-ok", aging: "bg-warn", stale: "bg-bad", unavailable: "bg-bad" };
const FRESH_LABEL: Record<string, string> = { fresh: "Fresh", aging: "Aging", stale: "Stale", unavailable: "Unavailable" };

/**
 * Reference FX benchmark: both sources side by side, which one the policy selected and why.
 * Labelled "Reference FX rate" throughout: it is never a bank's or provider's offered rate.
 */
export function FxBenchmarkPanel() {
  const { meta } = useShell();
  const [pair, setPair] = useState<"MXN" | "INR">("MXN");
  const { data, reload } = useApi<{ items: SnapshotView[] }>(`/api/fx/benchmark?quote=${pair}`);
  const [adopt, setAdopt] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const canFetch = !!meta?.permissions["rates:write"];
  const s = data?.items[0] ?? null;

  const fetchNow = async () => {
    setBusy(true);
    try {
      const r = await apiSend<{ snapshot: SnapshotView; adoptedRateId: string | null; adoptError: string | null }>("POST", "/api/fx/benchmark", { quote: pair, adopt: pair === "MXN" && adopt });
      if (r.adoptedRateId) toast.success(`Reference rate ${fmtRate(r.snapshot.selectedRate!)} adopted for new estimates. Existing estimates are unchanged.`);
      else if (r.adoptError) toast.error(r.adoptError);
      else toast.success("Benchmark recorded.");
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "The reference rate could not be retrieved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="px-4 py-7 md:px-6" aria-label="Reference FX benchmark">
      <SectionTitle aside={`Policy ${s?.policyVersion ?? "fx-benchmark-v1"} · never averaged`}>Reference FX rate (benchmark)</SectionTitle>
      <p className="max-w-[760px] text-[13px] text-meta">
        Independent reference rates from public and licensed data sources. A reference rate is <b className="font-[590] text-label">not</b> a rate any bank or provider will give you, and it does not guarantee what the supplier receives.
        Frankfurter is the primary source and currencyapi.com the secondary. If the primary is unusable the secondary is used, and that fallback is recorded.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Currency pair" className="flex gap-1">
          {(["MXN", "INR"] as const).map((q) => (
            <Button key={q} size="sm" variant={pair === q ? "primary" : "secondary"} onClick={() => setPair(q)} aria-pressed={pair === q}>
              USD/{q}
              {q === "INR" ? " (control)" : ""}
            </Button>
          ))}
        </div>
        {canFetch && (
          <>
            <Button size="sm" icon={<RefreshCw size={13} />} loading={busy} onClick={fetchNow}>
              Fetch reference rate now
            </Button>
            {pair === "MXN" && <Checkbox checked={adopt} onChange={setAdopt} label="Use it for new estimates" />}
          </>
        )}
      </div>

      {!s ? (
        <p className="mt-4 text-[13px] text-meta">No benchmark recorded for USD/{pair} yet.</p>
      ) : (
        <div className="mt-4 max-w-[900px]">
          <div className="overflow-x-auto rounded-[9px] border border-hairline">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-meta">
                  <th className="px-3 py-2 font-[510]">Source</th>
                  <th className="px-3 py-2 text-right font-[510]">Rate</th>
                  <th className="px-3 py-2 font-[510]">Observed by source</th>
                  <th className="px-3 py-2 font-[510]">Retrieved</th>
                  <th className="px-3 py-2 font-[510]">Status</th>
                  <th className="px-3 py-2 font-[510]">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {s.evidence.map((e) => (
                  <tr key={e.observationId} className={clsx("border-b border-hairline align-top last:border-0", e.provider === s.selectedProvider && "bg-group/50")}>
                    <td className="px-3 py-2.5">
                      <div className="font-[510] text-figure">
                        {NAME[e.provider] ?? e.provider}
                        {e.provider === s.selectedProvider && <span className="ml-1.5 text-xs font-[510] text-accent-hover">selected</span>}
                      </div>
                      {e.attribution && <div className="mt-0.5 text-xs text-meta">{e.attribution}</div>}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right font-[590] text-figure">{e.rate ? fmtRate(e.rate) : "—"}</td>
                    <td className="tnum px-3 py-2.5 text-label">{e.observedAt ? fmtStamp(e.observedAt) : "—"}</td>
                    <td className="tnum px-3 py-2.5 text-label">
                      {fmtStamp(e.retrievedAt)}
                      {e.cached && <span className="ml-1 text-xs text-meta">(cached)</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-label">
                        <span className={clsx("h-1.5 w-1.5 rounded-full", e.usable ? FRESH_TONE[e.freshness] : "bg-bad")} />
                        {e.usable ? FRESH_LABEL[e.freshness] : "Not used"}
                      </span>
                      {e.reason && <div className="mt-0.5 max-w-[220px] text-xs text-meta">{e.reason}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {e.rawResponseHash ? (
                        <a className="text-accent-hover underline" href={`/api/integrations/payloads/${e.rawResponseHash}`} target="_blank" rel="noreferrer">
                          Raw response · {e.rawResponseHash.slice(0, 10)}
                        </a>
                      ) : (
                        <span className="text-meta">none</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tnum mt-3 text-[13px] text-label">
            {s.selectedRate ? (
              <>
                Benchmark: <b className="font-[590] text-figure">USD/{s.quote} {fmtRate(s.selectedRate)}</b> from {NAME[s.selectedProvider!] ?? s.selectedProvider}
                {s.fallbackUsed ? " (fallback)" : ""}, observed {fmtStamp(s.observedAt)}, recorded {fmtStamp(s.createdAt)} · {FRESH_LABEL[s.freshness]}
                {s.differencePercentage !== null && <> · secondary differs by {fmtPct(s.differencePercentage, 3)}</>}
              </>
            ) : (
              <>No usable reference rate. No estimate is computed from this benchmark.</>
            )}
          </p>
          {s.warnings.length > 0 && (
            <Notice tone={s.selectedRate ? "warn" : "error"} className="mt-3" title="Warnings">
              <ul className="list-disc pl-4">
                {s.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}
    </section>
  );
}
