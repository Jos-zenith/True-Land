"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader, PageIntro } from "@/components/ui/layout";
import { ErrorState, EmptyState, SkeletonRows } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/field";
import { SearchBox } from "@/components/checks/filters";
import { useApi } from "@/hooks/use-api";
import { useNicknames } from "@/hooks/use-nicknames";
import { fmtStamp } from "@/lib/format";
import type { AuditEntry } from "@/server/views";

const GROUPS: Record<string, string[]> = {
  estimates: ["estimate_computed", "calc_failed", "inputs_modified"],
  decisions: ["quote_added", "route_selected", "plan_change"],
  outcomes: ["outcome_recorded", "outcome_corrected", "evidence_checked"],
  config: ["schedule_published", "rate_entered", "demo_reset"],
};

const TYPE_LABEL: Record<string, string> = {
  created: "Created",
  draft_saved: "Draft",
  estimate_computed: "Estimate",
  calc_failed: "Calc failed",
  inputs_modified: "Inputs",
  quote_added: "Quote",
  route_selected: "Choice",
  outcome_recorded: "Outcome",
  outcome_corrected: "Correction",
  evidence_checked: "Evidence",
  plan_change: "Plan change",
  note: "Note",
  archived: "Archived",
  restored: "Restored",
  duplicated: "Duplicated",
  export: "Export",
  schedule_published: "Schedule",
  rate_entered: "Rate",
  demo_reset: "Reset",
};

export default function AuditPage() {
  const { data, error, loading, reload } = useApi<{ items: AuditEntry[] }>("/api/audit");
  const { nameFor } = useNicknames();
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (e) =>
        (group === "all" || GROUPS[group]?.includes(e.type)) &&
        (!t || `${e.checkId ?? ""} ${e.message} ${e.actorName} ${e.supplierHash ? nameFor(e.supplierHash) : ""}`.toLowerCase().includes(t)),
    );
  }, [data, group, q, nameFor]);

  return (
    <>
      <PageHeader crumbs={[{ label: "Evidence & audit" }]} />
      <div className="flex-1 overflow-y-auto">
        <PageIntro
          title="Evidence & audit"
          description="Every estimate, quote, choice, outcome, receipt check and configuration change, in order. Entries are never edited or removed; a correction adds a new entry and the old one stays."
        />
        <div className="flex flex-wrap items-center gap-2 border-y border-hairline px-4 py-2 md:px-6">
          <Segmented
            size="sm"
            label="Event type"
            value={group}
            onChange={setGroup}
            options={[
              { value: "all", label: "All" },
              { value: "estimates", label: "Estimates" },
              { value: "decisions", label: "Decisions" },
              { value: "outcomes", label: "Outcomes" },
              { value: "config", label: "Configuration" },
            ]}
          />
          <SearchBox value={q} onChange={setQ} placeholder="Search events" className="ml-auto w-full sm:w-[240px]" />
        </div>
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={10} />
        ) : items.length === 0 ? (
          <EmptyState title="No matching events" body="Try another type or search." />
        ) : (
          <ol>
            {items.map((e) => (
              <li key={`${e.checkId}-${e.id}`} className="flex flex-col gap-1 border-b border-hairline px-4 py-2.5 text-[13px] sm:flex-row sm:items-baseline sm:gap-4 md:px-6">
                <span className="tnum w-[96px] shrink-0 text-meta">{fmtStamp(e.at)}</span>
                <span className="w-[84px] shrink-0">
                  <span className="rounded-[4px] border border-hairline-strong px-1.5 py-px text-[11px] text-meta">{TYPE_LABEL[e.type] ?? e.type}</span>
                </span>
                <span className="w-[150px] shrink-0 truncate">
                  {e.checkId ? (
                    <Link href={`/checks/${e.checkId}`} className="font-[510] text-label hover:text-figure">
                      {e.checkId} <span className="font-normal text-meta">{e.supplierHash ? nameFor(e.supplierHash) : ""}</span>
                    </Link>
                  ) : (
                    <span className="text-meta">Workspace</span>
                  )}
                </span>
                <span className="min-w-0 flex-1 text-label">{e.type === "note" ? `“${e.message}”` : e.message}</span>
                <span className="shrink-0 text-meta">{e.actorName}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
