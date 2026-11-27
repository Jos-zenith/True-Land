"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { ArrowDownUp, SquarePen } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { StatusIcon } from "@/components/ui/chip";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { CheckRow } from "@/components/checks/check-row";
import { ActiveFilters, FilterMenu, SearchBox, type FilterState } from "@/components/checks/filters";
import { applyFilters, EVIDENCE_FILTER, GROUP_ORDER, routeFilterDef, sortItems, statusFilterDef, type SortKey } from "@/components/checks/list-tools";
import { useShell } from "@/components/shell/shell-context";
import { useApi } from "@/hooks/use-api";
import { useNicknames } from "@/hooks/use-nicknames";
import { fmtMoney } from "@/lib/format";
import { GROUP_LABEL } from "@/server/views-labels";
import type { CheckListItem, ListGroup } from "@/server/views";

type Tab = "action" | "reconciled" | "all";
const ACTION_GROUPS: ListGroup[] = ["calc_failed", "draft", "choose_route", "reply_overdue", "awaiting_receipt"];
const SORT_LABEL: Record<SortKey, string> = { payBy: "Pay-by date", amount: "Amount sent", updated: "Last updated", id: "Check ID" };

export default function MyChecksPage() {
  const { openComposer } = useShell();
  const { nameFor } = useNicknames();
  const { data, error, loading, reload } = useApi<{ items: CheckListItem[]; summary: { open: number; shortfallMxn: string; shortfallUsd: string; awaiting: number; reconciled: number; insideRange: number } }>("/api/checks?scope=mine");
  const [tab, setTab] = useState<Tab>("action");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState>({});
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "payBy", dir: "asc" });

  const all = useMemo(() => (data?.items ?? []).filter((i) => !i.archived), [data]);
  const inTab = useMemo(
    () => all.filter((i) => (tab === "action" ? ACTION_GROUPS.includes(i.group) : tab === "reconciled" ? i.group === "reconciled" : true)),
    [all, tab],
  );
  const shown = useMemo(() => sortItems(applyFilters(inTab, filters, search, nameFor), sort.key, sort.dir), [inTab, filters, search, nameFor, sort]);
  const groups = GROUP_ORDER.map((g) => ({ g, items: shown.filter((i) => i.group === g) })).filter((x) => x.items.length);
  const defs = [statusFilterDef(), routeFilterDef(all), EVIDENCE_FILTER];

  // Summary strip (wireframe): open checks, modelled shortfall, awaiting amount, inside-range record. Computed by the server.
  const sm = data?.summary;

  const tabs: { id: Tab; label: string }[] = [
    { id: "action", label: "Needs action" },
    { id: "reconciled", label: "Reconciled" },
    { id: "all", label: "All" },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: "My checks" }]}
        actions={
          <Button variant="primary" icon={<SquarePen size={13} />} kbd="C" onClick={() => openComposer()}>
            <span className="hidden sm:inline">New check</span>
          </Button>
        }
      >
        <div role="tablist" aria-label="Views" className="ml-2 hidden items-center gap-0.5 sm:flex">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={clsx("h-7 rounded-[7px] px-2.5 text-[13px] font-[510] transition-colors", tab === t.id ? "bg-active text-figure shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]" : "text-meta hover:text-label")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-hairline px-4 py-2.5 text-[13px] text-meta md:px-6">
        <span>
          <b className="tnum font-[590] text-figure">{sm?.open ?? "—"}</b> open
        </span>
        <span>
          Expected shortfall{" "}
          <b className="tnum font-[590] text-figure">
            {sm ? [Number(sm.shortfallMxn) > 0 && fmtMoney(sm.shortfallMxn, "MXN"), Number(sm.shortfallUsd) > 0 && fmtMoney(sm.shortfallUsd, "USD")].filter(Boolean).join(" · ") || "none" : "—"}
          </b>{" "}
          modelled
        </span>
        <span>
          <b className="tnum font-[590] text-figure">{sm?.awaiting ?? "—"}</b> awaiting the actual amount
        </span>
        <span>
          Actual inside range{" "}
          <b className="tnum font-[590] text-figure">
            {sm ? `${sm.insideRange} of ${sm.reconciled}` : "—"}
          </b>
          {sm && sm.reconciled < 20 && ", too few to judge"}
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-4 py-2 md:px-6">
        <div role="tablist" aria-label="Views" className="flex items-center gap-0.5 sm:hidden">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={clsx("h-7 rounded-[7px] px-2 text-[13px] font-[510]", tab === t.id ? "bg-active text-figure" : "text-meta")}>
              {t.label}
            </button>
          ))}
        </div>
        <FilterMenu defs={defs} state={filters} onChange={setFilters} />
        <ActiveFilters defs={defs} state={filters} onChange={setFilters} />
        <div className="ml-auto flex items-center gap-2">
          <SearchBox value={search} onChange={setSearch} placeholder="Search checks" className="w-[180px] md:w-[220px]" />
          <Menu>
            <MenuTrigger asChild>
              <button className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-hairline-strong px-2 text-[13px] font-[510] text-label hover:bg-hover" aria-label="Sort">
                <ArrowDownUp size={13} className="text-meta" />
                <span className="hidden md:inline">{SORT_LABEL[sort.key]}</span>
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Sort by</MenuLabel>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <MenuItem key={k} onSelect={() => setSort({ ...sort, key: k })} kbd={sort.key === k ? "✓" : undefined}>
                  {SORT_LABEL[k]}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onSelect={() => setSort({ ...sort, dir: "asc" })} kbd={sort.dir === "asc" ? "✓" : undefined}>
                Ascending
              </MenuItem>
              <MenuItem onSelect={() => setSort({ ...sort, dir: "desc" })} kbd={sort.dir === "desc" ? "✓" : undefined}>
                Descending
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={7} />
        ) : all.length === 0 ? (
          <EmptyState title="No checks yet" body="Check a payment before you send it." action={<Button variant="primary" onClick={() => openComposer()}>New payment check</Button>} />
        ) : groups.length === 0 ? (
          <EmptyState
            title={search || Object.values(filters).some((v) => v.length) ? "No checks match" : tab === "action" ? "Nothing needs action" : "Nothing here yet"}
            body={search || Object.values(filters).some((v) => v.length) ? "Try a different search or clear the filters." : "Checks appear here as they move through their lifecycle."}
            action={
              (search || Object.values(filters).some((v) => v.length)) && (
                <Button
                  onClick={() => {
                    setSearch("");
                    setFilters({});
                  }}
                >
                  Clear search and filters
                </Button>
              )
            }
          />
        ) : (
          groups.map(({ g, items }) => (
            <section key={g} aria-label={GROUP_LABEL[g]}>
              <h2 className="flex h-9 items-center gap-2.5 border-b border-hairline bg-group px-4 text-[13px] font-[510] text-label md:px-6">
                <StatusIcon group={g} />
                {GROUP_LABEL[g]}
                <span className="tnum text-meta">{items.length}</span>
              </h2>
              {items.map((i) => (
                <CheckRow key={i.id} item={i} />
              ))}
            </section>
          ))
        )}
      </div>
    </>
  );
}
