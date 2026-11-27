"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, SquarePen } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { Button, IconButton } from "@/components/ui/button";
import { EvidenceWord, StatusIcon } from "@/components/ui/chip";
import { Checkbox } from "@/components/ui/field";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { RowMenu } from "@/components/checks/check-row";
import { ActiveFilters, FilterMenu, SearchBox, type FilterState } from "@/components/checks/filters";
import { applyFilters, CORRIDOR_FILTER, EVIDENCE_FILTER, routeFilterDef, statusFilterDef } from "@/components/checks/list-tools";
import { useShell } from "@/components/shell/shell-context";
import { useApi } from "@/hooks/use-api";
import { useNicknames } from "@/hooks/use-nicknames";
import { fmtDay, fmtMoney, fmtSigned } from "@/lib/format";
import type { CheckListItem } from "@/server/views";

type Col = "id" | "status" | "sent" | "expected" | "actual" | "ourError" | "quoteError" | "replyDue" | "updated";
const PAGE = 10;

const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

export default function AllChecksPage() {
  const router = useRouter();
  const { openComposer } = useShell();
  const { nameFor } = useNicknames();
  const { data, error, loading, reload } = useApi<{ items: CheckListItem[] }>("/api/checks?scope=all");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState>({});
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "id", dir: -1 });
  const [page, setPage] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const all = useMemo(() => data?.items ?? [], [data]);
  const creators = useMemo(() => [...new Map(all.map((i) => [i.createdBy.id, i.createdBy.name])).entries()], [all]);
  const defs = [statusFilterDef(), CORRIDOR_FILTER, routeFilterDef(all), EVIDENCE_FILTER, { key: "createdBy", label: "Created by", options: creators.map(([id, name]) => ({ value: id, label: name })) }];

  const rows = useMemo(() => {
    let list = applyFilters(all, filters, search, nameFor).filter((i) => showArchived || !i.archived);
    if (from) list = list.filter((i) => i.createdAt.slice(0, 10) >= from);
    if (to) list = list.filter((i) => i.createdAt.slice(0, 10) <= to);
    const key = (i: CheckListItem): string | number | null => {
      switch (sort.col) {
        case "id": return i.id;
        case "status": return i.statusLabel;
        case "sent": return Number(i.sendAmount);
        case "expected": return num(i.expected?.value);
        case "actual": return num(i.actual?.value);
        case "ourError": return num(i.ourError);
        case "quoteError": return num(i.quoteError);
        case "replyDue": return i.replyDue;
        case "updated": return i.updatedAt;
      }
    };
    return [...list].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === null && kb === null) return a.id.localeCompare(b.id);
      if (ka === null) return 1; // blanks last, whichever direction
      if (kb === null) return -1;
      const c = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
      return c * sort.dir || a.id.localeCompare(b.id);
    });
  }, [all, filters, search, nameFor, showArchived, from, to, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(page, pages - 1);
  const visible = rows.slice(p * PAGE, p * PAGE + PAGE);

  const th = (col: Col, label: string, right?: boolean, cls?: string) => (
    <th scope="col" aria-sort={sort.col === col ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={clsx("h-9 whitespace-nowrap px-3 font-[510]", right ? "text-right" : "text-left", cls)}>
      <button
        onClick={() => setSort((s) => ({ col, dir: s.col === col ? ((-s.dir) as 1 | -1) : col === "id" || col === "updated" ? -1 : 1 }))}
        className={clsx("inline-flex items-center gap-1 rounded-[4px] hover:text-label", sort.col === col ? "text-label" : "text-meta", right && "flex-row-reverse")}
      >
        {label}
        {sort.col === col ? sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : <span className="w-[11px]" />}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: "All checks" }]}
        actions={
          <Button variant="primary" icon={<SquarePen size={13} />} kbd="C" onClick={() => openComposer()}>
            <span className="hidden sm:inline">New check</span>
          </Button>
        }
      >
        <span className="tnum text-[13px] text-meta">{data ? rows.length : ""}</span>
      </PageHeader>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-4 py-2 md:px-6">
        <FilterMenu defs={defs} state={filters} onChange={(s) => { setFilters(s); setPage(0); }} />
        <ActiveFilters defs={defs} state={filters} onChange={(s) => { setFilters(s); setPage(0); }} />
        <div className="flex items-center gap-1.5 text-[13px] text-meta">
          <label htmlFor="from">Created</label>
          <input id="from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="tnum h-7 rounded-[7px] border border-hairline-strong bg-transparent px-2 text-[13px] text-label focus-visible:border-ring focus-visible:outline-none" aria-label="Created from" />
          <span>to</span>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="tnum h-7 rounded-[7px] border border-hairline-strong bg-transparent px-2 text-[13px] text-label focus-visible:border-ring focus-visible:outline-none" aria-label="Created to" />
        </div>
        <Checkbox checked={showArchived} onChange={setShowArchived} label="Show archived" />
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Search ID, supplier, ref" className="ml-auto w-full sm:w-[240px]" />
      </div>

      <div className="flex-1 overflow-auto">
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState title={all.length ? "No checks match" : "No checks yet"} body={all.length ? "Try a different search, date range or filter." : "Check a payment before you send it."} action={all.length ? <Button onClick={() => { setFilters({}); setSearch(""); setFrom(""); setTo(""); }}>Clear all</Button> : <Button variant="primary" onClick={() => openComposer()}>New payment check</Button>} />
        ) : (
          <table className="w-full min-w-[900px] text-[13px]">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="border-b border-hairline">
                <th className="w-6 pl-4 md:pl-6" aria-label="Status icon" />
                {th("id", "ID")}
                <th scope="col" className="px-3 text-left font-[510] text-meta">Supplier</th>
                {th("status", "Status")}
                <th scope="col" className="hidden px-3 text-left font-[510] text-meta 2xl:table-cell">Corridor</th>
                {th("sent", "Sent", true)}
                {th("expected", "Expected", true)}
                {th("actual", "Actual", true)}
                {th("ourError", "Our error", true)}
                {th("quoteError", "Quote error", true)}
                {th("replyDue", "Reply due")}
                <th scope="col" className="px-3 text-left font-[510] text-meta">Evidence</th>
                {th("updated", "Updated", false, "hidden min-[1600px]:table-cell")}
                <th className="w-8" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="tnum">
              {visible.map((i) => (
                <tr
                  key={i.id}
                  tabIndex={0}
                  onClick={() => router.push(`/checks/${i.id}`)}
                  onKeyDown={(e) => e.key === "Enter" && router.push(`/checks/${i.id}`)}
                  className={clsx("group h-10 cursor-default border-b border-hairline transition-colors hover:bg-hover focus-visible:bg-hover", i.archived && "opacity-60")}
                  aria-label={`${i.id}, ${nameFor(i.supplierHash)}, ${i.statusLabel}`}
                >
                  <td className="pl-4 md:pl-6"><StatusIcon group={i.group} /></td>
                  <td className="whitespace-nowrap px-3 text-meta">{i.id}</td>
                  <td className="max-w-[160px] truncate px-3 font-[510] text-figure">{nameFor(i.supplierHash)}</td>
                  <td className="whitespace-nowrap px-3 text-label">{i.statusLabel}{i.insideRange === false ? ", outside range" : ""}</td>
                  <td className="hidden whitespace-nowrap px-3 text-meta 2xl:table-cell">{i.corridor}</td>
                  <td className="whitespace-nowrap px-3 text-right text-label">{fmtMoney(i.sendAmount, "USD")}</td>
                  <td className="whitespace-nowrap px-3 text-right text-label">{i.expected ? fmtMoney(i.expected.value, i.expected.currency) : <span className="text-meta">—</span>}</td>
                  <td className="whitespace-nowrap px-3 text-right text-label">{i.actual ? fmtMoney(i.actual.value, i.actual.currency) : <span className="text-meta">—</span>}</td>
                  <td className="whitespace-nowrap px-3 text-right text-label">{i.ourError !== null ? fmtSigned(i.ourError) : <span className="text-meta">—</span>}</td>
                  <td className="whitespace-nowrap px-3 text-right text-label">{i.quoteError !== null ? fmtSigned(i.quoteError) : i.actual ? <span className="text-meta">none given</span> : <span className="text-meta">—</span>}</td>
                  <td className={clsx("whitespace-nowrap px-3", i.replyOverdue ? "text-short" : "text-label")}>{i.replyDue ? `${fmtDay(i.replyDue)}${i.replyOverdue ? ", late" : ""}` : <span className="text-meta">—</span>}</td>
                  <td className="whitespace-nowrap px-3 text-label"><EvidenceWord level={i.evidence} /></td>
                  <td className="hidden whitespace-nowrap px-3 text-meta min-[1600px]:table-cell">{fmtDay(i.updatedAt)}</td>
                  <td className="pr-2" onClick={(e) => e.stopPropagation()}><RowMenu item={i} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-2 text-xs text-meta md:px-6">
        <span>Our error = actual − estimate. Quote error = quote − actual. Demo records are illustrative, not customer payments.</span>
        {rows.length > PAGE && (
          <span className="flex items-center gap-1">
            <span className="tnum mr-1">
              {p * PAGE + 1}–{Math.min(rows.length, (p + 1) * PAGE)} of {rows.length}
            </span>
            <IconButton label="Previous page" size="sm" disabled={p === 0} onClick={() => setPage(p - 1)}>
              <ChevronLeft size={14} />
            </IconButton>
            <IconButton label="Next page" size="sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>
              <ChevronRight size={14} />
            </IconButton>
          </span>
        )}
      </div>
    </>
  );
}
