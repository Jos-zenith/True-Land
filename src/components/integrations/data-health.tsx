"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { fmtRate, fmtStamp } from "@/lib/format";
import type { IntegrationsView } from "./integrations-panel";

/** Overview card: FX data-source health, last benchmark, provider status, failures needing attention. */
export function DataHealthCard() {
  const { data } = useApi<IntegrationsView>("/api/integrations");
  if (!data) return null;
  const b = data.latestBenchmark.MXN;
  const connected = data.providers.filter((p) => p.status === "Connected").length;
  return (
    <section aria-label="Data sources" className="mt-5 rounded-[9px] border border-hairline px-4 py-3.5 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-[590] text-figure">Data sources</span>
        <Link href="/sources" className="inline-flex items-center gap-1 text-meta hover:text-label">
          Manage <ArrowRight size={12} />
        </Link>
      </div>
      <div className="tnum mt-2 grid gap-x-6 gap-y-1.5 text-label sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-meta">Reference USD/MXN: </span>
          {b?.selectedRate ? (
            <>
              {fmtRate(b.selectedRate)} <span className={clsx(b.freshness === "fresh" ? "text-ok-text" : "text-warn")}>({b.freshness})</span>
            </>
          ) : (
            <span className="text-meta">{b ? "unavailable" : "not fetched yet"}</span>
          )}
        </div>
        <div>
          <span className="text-meta">Last benchmark: </span>
          {b ? fmtStamp(b.createdAt) : "—"}
        </div>
        <div>
          <span className="text-meta">Integrations connected: </span>
          {connected} of {data.providers.length}
        </div>
        <div className={clsx(data.failures24h.length ? "text-warn" : "")}>
          <span className="text-meta">Failed requests (24 h): </span>
          {data.failures24h.length}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-meta">
        Estimates: {data.estimates.referenceRate} on a reference rate, {data.estimates.manualRate} on a manual rate, {data.estimates.sampleRate} on the sample rate.
      </p>
    </section>
  );
}
