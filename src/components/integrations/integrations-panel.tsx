"use client";

import { clsx } from "clsx";
import { SectionTitle } from "@/components/ui/layout";
import { useApi } from "@/hooks/use-api";
import { fmtStamp } from "@/lib/format";

export interface IntegrationsView {
  providers: {
    provider: string;
    name: string;
    role: string;
    status: "Connected" | "Configured but untested" | "Authentication failed" | "Unavailable" | "Not configured" | "Demo mode";
    environment: string;
    configuration: string;
    functions: string[];
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastErrorCode: string | null;
  }[];
  failures24h: { provider: string; event_type: string; error_code: string | null; occurred_at: string }[];
  latestBenchmark: { MXN: { selectedRate: string | null; selectedProvider: string | null; freshness: string; createdAt: string; observedAt: string | null } | null };
  estimates: { total: number; referenceRate: number; manualRate: number; sampleRate: number; noRate: number };
}

const TONE: Record<string, string> = {
  Connected: "bg-ok",
  "Configured but untested": "bg-meta",
  "Not configured": "bg-meta",
  "Demo mode": "bg-meta",
  "Authentication failed": "bg-bad",
  Unavailable: "bg-warn",
};

/**
 * Provider integrations with honest status. "Connected" means a real call succeeded and was recorded,
 * and nothing failed after it. A key being present is only "Configured but untested".
 */
export function IntegrationsPanel() {
  const { data } = useApi<IntegrationsView>("/api/integrations");
  if (!data) return null;
  return (
    <section className="px-4 py-7 md:px-6" aria-label="Provider integrations">
      <SectionTitle aside={`${data.failures24h.length} failed request${data.failures24h.length === 1 ? "" : "s"} in 24 h`}>Provider integrations</SectionTitle>
      <div className="overflow-x-auto rounded-[9px] border border-hairline">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left text-meta">
              <th className="px-3 py-2 font-[510]">Provider</th>
              <th className="px-3 py-2 font-[510]">Status</th>
              <th className="px-3 py-2 font-[510]">Environment</th>
              <th className="px-3 py-2 font-[510]">Last success</th>
              <th className="px-3 py-2 font-[510]">Last failure</th>
              <th className="px-3 py-2 font-[510]">Supports</th>
              <th className="px-3 py-2 font-[510]">Configuration</th>
            </tr>
          </thead>
          <tbody>
            {data.providers.map((p) => (
              <tr key={p.provider} className="border-b border-hairline align-top last:border-0">
                <td className="px-3 py-2.5">
                  <div className="font-[510] text-figure">{p.name}</div>
                  <div className="mt-0.5 max-w-[240px] text-xs text-meta">{p.role}</div>
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-label">
                    <span className={clsx("h-1.5 w-1.5 rounded-full", TONE[p.status])} />
                    {p.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-label">{p.environment.replace("_", " ")}</td>
                <td className="tnum px-3 py-2.5 text-label">{p.lastSuccessAt ? fmtStamp(p.lastSuccessAt) : <span className="text-meta">never</span>}</td>
                <td className="tnum px-3 py-2.5 text-label">
                  {p.lastFailureAt ? (
                    <>
                      {fmtStamp(p.lastFailureAt)}
                      {p.lastErrorCode && <div className="text-xs text-meta">{p.lastErrorCode.replace("_", " ")}</div>}
                    </>
                  ) : (
                    <span className="text-meta">none</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-meta">{p.functions.join(" · ")}</td>
                <td className="max-w-[260px] px-3 py-2.5 text-xs text-meta">{p.configuration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-meta">
        Estimates by rate source: {data.estimates.referenceRate} reference-rate, {data.estimates.manualRate} manually entered, {data.estimates.sampleRate} sample (demo), {data.estimates.noRate} without a rate.
      </p>
    </section>
  );
}
