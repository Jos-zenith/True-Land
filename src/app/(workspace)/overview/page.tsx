"use client";

import Link from "next/link";
import { ArrowRight, SquarePen } from "lucide-react";
import { PageHeader, PageIntro, SectionTitle } from "@/components/ui/layout";
import { Button } from "@/components/ui/button";
import { Notice, SkeletonRows, ErrorState, EmptyState } from "@/components/ui/feedback";
import { CheckRow } from "@/components/checks/check-row";
import { ActivityList } from "@/components/finance/activity";
import { useShell } from "@/components/shell/shell-context";
import { useApi } from "@/hooks/use-api";
import { fmtMoney, fmtNum } from "@/lib/format";
import type { CheckListItem } from "@/server/views";
import { DataHealthCard } from "@/components/integrations/data-health";

interface OverviewData {
  metrics: {
    total: number;
    mine: number;
    valueCheckedUsd: string;
    awaitingOutcome: number;
    overdue: number;
    attention: number;
    open: number;
    shortfallMxn: string;
    shortfallUsd: string;
    reconciled: number;
    insideRange: number;
  };
  recent: CheckListItem[];
  activity: { id: string; at: string; actor: string; actorName: string; type: string; message: string; checkId: string | null }[];
}

function Metric({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <div className="flex h-full flex-col px-4 py-3 transition-colors hover:bg-hover md:px-5">
      <span className="text-[13px] text-meta">{label}</span>
      <span className="figure mt-0.5 text-[20px] font-[590] text-figure">{value}</span>
      {sub && <span className="mt-0.5 text-xs text-meta">{sub}</span>}
    </div>
  );
  return href ? (
    <Link href={href} className="bg-panel">
      {body}
    </Link>
  ) : (
    <div className="bg-panel">{body}</div>
  );
}

export default function OverviewPage() {
  const { meta, openComposer } = useShell();
  const { data, error, loading, reload } = useApi<OverviewData>("/api/overview");
  const m = data?.metrics;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Overview" }]}
        actions={
          <Button variant="primary" icon={<SquarePen size={13} />} kbd="C" onClick={() => openComposer()}>
            New payment check
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <PageIntro
          title={meta?.workspace.name ?? "Overview"}
          description="Before you pay an overseas supplier, see how much is likely to arrive, compare routes, then reconcile what actually landed."
        />
        <div className="px-4 md:px-6">
          {meta?.workspace.isDemo && (
            <Notice className="mb-5" title="Demo workspace">
              Every check, fee and sample rate here is illustrative, not a real customer payment. Reference FX rates and Wise quotes, when fetched, are real data and labelled as such. Landed never moves money.{" "}
              <Link href="/help#walkthrough" className="text-label underline decoration-hairline-strong underline-offset-2 hover:text-figure">
                See the 10-step walkthrough
              </Link>
              .
            </Notice>
          )}

          {error ? (
            <ErrorState message={error.message} onRetry={reload} />
          ) : (
            <section aria-label="Key figures" className="grid grid-cols-2 gap-px overflow-hidden rounded-[9px] border border-hairline bg-hairline md:grid-cols-5">
              <Metric label="Checks" value={m ? fmtNum(m.total) : "—"} sub={m ? `${m.mine} mine · ${m.open} open` : " "} href="/checks" />
              <Metric label="Payment value checked" value={m ? fmtMoney(m.valueCheckedUsd, "USD") : "—"} sub="Sum of amounts sent" href="/checks" />
              <Metric label="Awaiting outcome" value={m ? fmtNum(m.awaitingOutcome) : "—"} sub={m ? `${m.overdue} reply overdue` : " "} href="/my-checks" />
              <Metric label="Needs attention" value={m ? fmtNum(m.attention) : "—"} sub={meta ? `${meta.inboxCount} in inbox` : " "} href="/inbox" />
              <Metric
                label="Actual inside range"
                value={m ? `${m.insideRange} of ${m.reconciled}` : "—"}
                sub={m && m.reconciled < 20 ? "Too few to judge accuracy" : "Reconciled checks"}
                href="/routes"
              />
            </section>
          )}
          {m && (Number(m.shortfallMxn) > 0 || Number(m.shortfallUsd) > 0) && (
            <p className="mt-2.5 text-xs text-meta">
              Open checks may arrive short by about{" "}
              <span className="tnum text-label">
                {[Number(m.shortfallMxn) > 0 && fmtMoney(m.shortfallMxn, "MXN"), Number(m.shortfallUsd) > 0 && fmtMoney(m.shortfallUsd, "USD")].filter(Boolean).join(" and ")}
              </span>{" "}
              in total (modelled, typical case).
            </p>
          )}
          <DataHealthCard />
        </div>

        <div className="mt-7 grid gap-8 px-0 pb-10 xl:grid-cols-[minmax(0,1fr)_380px] xl:px-6">
          <section aria-label="Recent payment checks" className="min-w-0">
            <SectionTitle className="px-4 md:px-6 xl:px-0" aside={<Link href="/checks" className="inline-flex items-center gap-1 hover:text-label">All checks <ArrowRight size={12} /></Link>}>
              Recent payment checks
            </SectionTitle>
            <div className="border-t border-hairline xl:rounded-[9px] xl:border xl:[&>*:last-child]:border-b-0">
              {loading ? (
                <SkeletonRows rows={5} />
              ) : data?.recent.length ? (
                data.recent.map((i) => <CheckRow key={i.id} item={i} showStatusIcon dateMode="updated" compact />)
              ) : (
                <EmptyState title="No checks yet" body="Check a payment before you send it." action={<Button variant="primary" onClick={() => openComposer()}>New payment check</Button>} />
              )}
            </div>
          </section>
          <section aria-label="Recent activity" className="min-w-0 px-4 md:px-6 xl:px-0">
            <SectionTitle aside={<Link href="/audit" className="inline-flex items-center gap-1 hover:text-label">Evidence & audit <ArrowRight size={12} /></Link>}>Recent activity</SectionTitle>
            {loading ? <SkeletonRows rows={5} /> : <ActivityList events={data?.activity ?? []} showCheck dense />}
          </section>
        </div>
      </div>
    </>
  );
}
