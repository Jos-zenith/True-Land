"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { ListFilter, Search, X } from "lucide-react";
import { Menu, MenuCheckItem, MenuContent, MenuLabel, MenuSeparator, MenuSub, MenuTrigger } from "@/components/ui/overlay";
import { Kbd } from "@/components/ui/button";

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export type FilterState = Record<string, string[]>;

/** Property-first filter menu (wireframe): choose a property, then search and tick values. */
export function FilterMenu({ defs, state, onChange }: { defs: FilterDef[]; state: FilterState; onChange: (s: FilterState) => void }) {
  const [term, setTerm] = useState<Record<string, string>>({});
  const toggle = (key: string, value: string, on: boolean) => {
    const cur = state[key] ?? [];
    onChange({ ...state, [key]: on ? [...cur, value] : cur.filter((v) => v !== value) });
  };
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="inline-flex h-7 items-center gap-1.5 rounded-[7px] border border-hairline-strong px-2 text-[13px] font-[510] text-label hover:bg-hover">
          <ListFilter size={13} className="text-meta" />
          Filter
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[220px]">
        <MenuLabel>Filter by…</MenuLabel>
        {defs.map((d) => {
          const t = (term[d.key] ?? "").toLowerCase();
          return (
            <MenuSub key={d.key} label={`${d.label}${state[d.key]?.length ? ` · ${state[d.key].length}` : ""}`}>
              <div className="p-1">
                <input
                  value={term[d.key] ?? ""}
                  onChange={(e) => setTerm({ ...term, [d.key]: e.target.value })}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={`Search ${d.label.toLowerCase()}`}
                  aria-label={`Search ${d.label.toLowerCase()}`}
                  className="mb-1 h-8 w-[200px] rounded-[6px] border border-control-soft bg-panel px-2 text-[13px] text-figure placeholder:text-meta focus-visible:border-ring focus-visible:outline-none"
                />
              </div>
              {d.options
                .filter((o) => o.label.toLowerCase().includes(t))
                .map((o) => (
                  <MenuCheckItem key={o.value} checked={(state[d.key] ?? []).includes(o.value)} onCheckedChange={(v) => toggle(d.key, o.value, v)}>
                    {o.label}
                  </MenuCheckItem>
                ))}
            </MenuSub>
          );
        })}
        {Object.values(state).some((v) => v.length) && (
          <>
            <MenuSeparator />
            <button className="flex h-8 w-full items-center rounded-[5px] px-2 text-left text-[13px] text-meta hover:bg-active hover:text-label" onClick={() => onChange({})}>
              Clear all filters
            </button>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

export function ActiveFilters({ defs, state, onChange }: { defs: FilterDef[]; state: FilterState; onChange: (s: FilterState) => void }) {
  const active = defs.filter((d) => state[d.key]?.length);
  if (!active.length) return null;
  return (
    <>
      {active.map((d) => (
        <span key={d.key} className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-hairline-strong pl-2 pr-1 text-[13px] text-meta">
          {d.label} is
          <span className="max-w-[200px] truncate font-[510] text-figure">
            {state[d.key].map((v) => d.options.find((o) => o.value === v)?.label ?? v).join(", ")}
          </span>
          <button aria-label={`Remove ${d.label} filter`} className="rounded-[4px] p-0.5 hover:bg-active hover:text-label" onClick={() => onChange({ ...state, [d.key]: [] })}>
            <X size={12} />
          </button>
        </span>
      ))}
    </>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  // "/" focuses the search box (off while typing or while an overlay is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={clsx("relative", className)}>
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-meta" aria-hidden />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-7 w-full rounded-[7px] border border-hairline-strong bg-transparent pl-7 pr-7 text-[13px] text-figure placeholder:text-meta transition-colors hover:border-control-soft focus-visible:border-ring focus-visible:outline-none"
      />
      {value ? (
        <button aria-label="Clear search" onClick={() => onChange("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[4px] p-0.5 text-meta hover:text-label">
          <X size={12} />
        </button>
      ) : (
        <Kbd className="pointer-events-none absolute right-1.5 top-1/2 hidden -translate-y-1/2 sm:inline-flex">/</Kbd>
      )}
    </div>
  );
}
