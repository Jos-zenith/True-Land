"use client";

import type { CheckListItem, ListGroup } from "@/server/views";
import { GROUP_LABEL } from "@/server/views-labels";
import type { FilterDef, FilterState } from "./filters";

export const GROUP_ORDER: ListGroup[] = ["calc_failed", "draft", "choose_route", "reply_overdue", "awaiting_receipt", "no_reply", "refused", "reconciled"];

export function statusFilterDef(): FilterDef {
  return {
    key: "status",
    label: "Status",
    options: [
      { value: "attention", label: "Needs attention" },
      ...GROUP_ORDER.map((g) => ({ value: g, label: GROUP_LABEL[g] })),
    ],
  };
}

export function routeFilterDef(items: CheckListItem[]): FilterDef {
  const labels = [...new Set(items.map((i) => i.routeLabel).filter(Boolean) as string[])].sort();
  return { key: "route", label: "Route", options: [{ value: "__none", label: "Not chosen yet" }, ...labels.map((l) => ({ value: l, label: l }))] };
}

export const EVIDENCE_FILTER: FilterDef = {
  key: "evidence",
  label: "Evidence level",
  options: [
    { value: "modelled", label: "Modelled" },
    { value: "reported", label: "Reported" },
    { value: "tax_record", label: "Tax record" },
    { value: "demo_verified", label: "Verified (demo)" },
    { value: "verified", label: "Verified" },
  ],
};

export const CORRIDOR_FILTER: FilterDef = {
  key: "corridor",
  label: "Corridor",
  options: [
    { value: "USD → MXN", label: "USD → MXN (peso invoice)" },
    { value: "USD → USD", label: "USD → USD (dollar invoice)" },
  ],
};

export function applyFilters(items: CheckListItem[], state: FilterState, search: string, nameFor: (h: string) => string) {
  const q = search.trim().toLowerCase();
  return items.filter((i) => {
    const st = state.status ?? [];
    if (st.length && !st.some((s) => (s === "attention" ? i.attention.length > 0 : i.group === s))) return false;
    const rt = state.route ?? [];
    if (rt.length && !rt.some((r) => (r === "__none" ? !i.routeLabel : i.routeLabel === r))) return false;
    const ev = state.evidence ?? [];
    if (ev.length && !ev.includes(i.evidence)) return false;
    const co = state.corridor ?? [];
    if (co.length && !co.includes(i.corridor)) return false;
    const by = state.createdBy ?? [];
    if (by.length && !by.includes(i.createdBy.id)) return false;
    if (q) {
      const hay = `${i.id} ${nameFor(i.supplierHash)} #${i.supplierHash} ${i.invoiceRef ?? ""} ${i.routeLabel ?? ""} ${i.statusLabel}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export type SortKey = "payBy" | "amount" | "updated" | "id";
export function sortItems(items: CheckListItem[], key: SortKey, dir: "asc" | "desc") {
  const m = dir === "asc" ? 1 : -1;
  const usdValue = (i: CheckListItem) => Number(i.sendAmount);
  return [...items].sort((a, b) => {
    let c = 0;
    if (key === "payBy") c = a.payBy.localeCompare(b.payBy);
    else if (key === "amount") c = usdValue(a) - usdValue(b);
    else if (key === "updated") c = a.updatedAt.localeCompare(b.updatedAt);
    else c = a.id.localeCompare(b.id);
    return c * m || a.id.localeCompare(b.id);
  });
}
