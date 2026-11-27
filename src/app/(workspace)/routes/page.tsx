"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { PageHeader, PageIntro } from "@/components/ui/layout";
import { ErrorState, Notice, SkeletonRows } from "@/components/ui/feedback";
import { useApi } from "@/hooks/use-api";
import { fmtDate, fmtPct, fmtSigned } from "@/lib/format";

interface RouteRow {
  id: string;
  provider: string;
  providerKind: string;
  route: string;
  method: string;
  corridor: string;
  speed: string;
  eligibility: "approved" | "unverified" | "disabled";
  eligibilityNote: string;
  lastVerifiedAt: string;
  scheduleStale: boolean;
  source: string;
  missing: string[];
  typicalMarkup: string | null;
  senderFee: string | null;
  checksUsed: number;
  timesChosen: number;
  outcomes: number;
  insideRange: number;
  meanError: string | null;
  destCurrency: string;
}

export default function RoutesPage() {
  const { data, error, loading, reload } = useApi<{ items: RouteRow[] }>("/api/routes");
  return (
    <>
      <PageHeader crumbs={[{ label: "Route intelligence" }]} />
      <div className="flex-1 overflow-y-auto">
        <PageIntro
          title="Route intelligence"
          description="The routes in the current fee schedule, whether they can be used, how complete their cost data is, and how their estimates have compared with recorded outcomes."
        />
        <div className="px-4 pb-4 md:px-6">
          <Notice>
            Outcome figures come only from reconciled checks in this workspace. With so few, they describe what happened; they do not measure accuracy.{" "}
            <Link href="/fees" className="text-label underline decoration-hairline-strong underline-offset-2 hover:text-figure">
              Edit assumptions in Fee configuration
            </Link>
            .
          </Notice>
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : loading || !data ? (
          <SkeletonRows rows={8} />
        ) : (
          <div className="overflow-x-auto border-t border-hairline">
            <table className="w-full min-w-[1040px] text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-meta">
                  <th className="px-4 py-2 font-[510] md:pl-6">Route</th>
                  <th className="px-3 py-2 font-[510]">Corridor</th>
                  <th className="px-3 py-2 font-[510]">Speed</th>
                  <th className="px-3 py-2 font-[510]">Eligibility</th>
                  <th className="px-3 py-2 text-right font-[510]">Typical markup</th>
                  <th className="px-3 py-2 font-[510]">Cost data</th>
                  <th className="px-3 py-2 font-[510]">Last verified</th>
                  <th className="px-3 py-2 text-right font-[510]">Checks · chosen</th>
                  <th className="px-4 py-2 text-right font-[510] md:pr-6">Outcomes · inside range · mean error</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {data.items.map((r) => (
                  <tr key={r.id} className={clsx("border-b border-hairline", r.eligibility !== "approved" && "text-meta")}>
                    <td className="px-4 py-2.5 md:pl-6">
                      <div className="font-[510] text-figure">{r.route}</div>
                      <div className="text-xs text-meta">
                        {r.providerKind} · {r.source}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-label">{r.corridor}</td>
                    <td className="px-3 py-2.5 text-label">{r.speed}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-label">
                        <span className={clsx("h-1.5 w-1.5 rounded-full", r.eligibility === "approved" ? "bg-ok" : r.eligibility === "unverified" ? "bg-warn" : "bg-deco")} />
                        {r.eligibility === "approved" ? "Approved" : r.eligibility === "unverified" ? "Unverified, never ranked" : "Disabled"}
                      </span>
                      {r.eligibility !== "approved" && <div className="max-w-[220px] text-xs text-meta">{r.eligibilityNote}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-label">{r.method === "usd_wire" ? <span className="text-meta">no FX</span> : r.typicalMarkup ? fmtPct(r.typicalMarkup) : <span className="text-warn">unknown</span>}</td>
                    <td className="px-3 py-2.5">{r.missing.length ? <span className="text-warn">Missing {r.missing.join(", ")}</span> : <span className="text-label">Complete</span>}</td>
                    <td className={clsx("px-3 py-2.5", r.scheduleStale ? "text-warn" : "text-label")}>
                      {fmtDate(r.lastVerifiedAt)}
                      {r.scheduleStale && ", stale"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-label">
                      {r.checksUsed} · {r.timesChosen}
                    </td>
                    <td className="px-4 py-2.5 text-right text-label md:pr-6">
                      {r.outcomes === 0 ? (
                        <span className="text-meta">none yet</span>
                      ) : (
                        <>
                          {r.outcomes} · {r.insideRange} of {r.outcomes} · {fmtSigned(r.meanError)} {r.destCurrency}
                          {r.outcomes < 20 && <span className="text-meta">, too few to judge</span>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-4 py-4 text-xs text-meta md:px-6">Mean error = average of (actual − estimate) across reconciled checks on that route. No route pays to be ranked higher.</p>
      </div>
    </>
  );
}
