"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { PenLine } from "lucide-react";
import { PageHeader, PageIntro, SectionTitle } from "@/components/ui/layout";
import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { SourceBadge } from "@/components/ui/chip";
import { useShell } from "@/components/shell/shell-context";
import { useApi } from "@/hooks/use-api";
import { fmtAgo, fmtRate, fmtStamp } from "@/lib/format";
import type { RateSnapshot, SourceClass } from "@/engine/types";
import { FxBenchmarkPanel } from "@/components/integrations/fx-benchmark-panel";
import { IntegrationsPanel } from "@/components/integrations/integrations-panel";

interface Sources {
  rate: RateSnapshot | null;
  rates: RateSnapshot[];
  list: { id: string; name: string; category: string; corridor: string; lastAt: string | null; freshness: string; status: "ok" | "warn" | "error"; statusLabel: string; classification: SourceClass; limitation: string }[];
}

export default function SourcesPage() {
  const { openRateDialog } = useShell();
  const { data, error, loading, reload } = useApi<Sources>("/api/sources");
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), [data]);
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Data sources" }]}
        actions={
          <Button icon={<PenLine size={13} />} onClick={() => openRateDialog()}>
            Enter a rate
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <PageIntro title="Data sources" description="Where every input comes from, how fresh it is, and what it cannot tell you. Reference FX rates can be retrieved from public sources; fee schedules are configured by hand; provider quotes are entered by hand or retrieved from Wise where available." />
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : loading || !data ? (
          <SkeletonRows rows={5} />
        ) : (
          <>
            <div className="overflow-x-auto border-y border-hairline">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead>
                  <tr className="border-b border-hairline text-left text-meta">
                    <th className="px-4 py-2 font-[510] md:pl-6">Source</th>
                    <th className="px-3 py-2 font-[510]">Category</th>
                    <th className="px-3 py-2 font-[510]">Corridor</th>
                    <th className="px-3 py-2 font-[510]">Last updated</th>
                    <th className="px-3 py-2 font-[510]">Freshness</th>
                    <th className="px-3 py-2 font-[510]">Status</th>
                    <th className="px-4 py-2 font-[510] md:pr-6">Known limitations</th>
                  </tr>
                </thead>
                <tbody>
                  {data.list.map((s) => (
                    <tr key={s.id} className="border-b border-hairline align-top last:border-0">
                      <td className="px-4 py-3 md:pl-6">
                        <div className="font-[510] text-figure">{s.name}</div>
                        <div className="mt-1 text-xs">
                          <SourceBadge cls={s.classification} />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-label">{s.category}</td>
                      <td className="px-3 py-3 text-label">{s.corridor}</td>
                      <td className="tnum px-3 py-3 text-label">{s.lastAt ? fmtStamp(s.lastAt) : <span className="text-meta">never</span>}</td>
                      <td className="tnum px-3 py-3 text-label">{s.freshness}</td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 text-label">
                          <span className={clsx("h-1.5 w-1.5 rounded-full", s.status === "ok" ? "bg-ok" : s.status === "warn" ? "bg-warn" : "bg-bad")} />
                          {s.statusLabel}
                        </span>
                      </td>
                      <td className="max-w-[360px] px-4 py-3 text-meta md:pr-6">{s.limitation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <FxBenchmarkPanel />
            <IntegrationsPanel />
            <section className="px-4 py-7 md:px-6" aria-label="Rate history">
              <SectionTitle aside="Each estimate keeps the rate it used">USD/MXN rate history</SectionTitle>
              <ul className="max-w-[680px]">
                {data.rates.map((r, i) => (
                  <li key={r.id} className="tnum flex items-center gap-3 border-b border-hairline py-2 text-[13px]">
                    <span className={clsx("w-[72px] font-[590]", i === 0 ? "text-figure" : "text-label")}>{fmtRate(r.rate)}</span>
                    <span className="flex-1 truncate text-meta">
                      {r.source}
                      {r.isDemo ? " · demo value" : ""}
                    </span>
                    <span className="text-meta">{fmtStamp(r.retrievedAt)}</span>
                    <span className="w-12 text-right text-meta">{now ? fmtAgo(r.retrievedAt, now) : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </>
  );
}
