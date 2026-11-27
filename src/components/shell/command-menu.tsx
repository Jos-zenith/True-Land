"use client";

import * as RD from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { ArrowRight, FileCheck2, PenLine, Plus, Search } from "lucide-react";
import { useShell } from "./shell-context";
import { useNicknames } from "@/hooks/use-nicknames";
import { GO_KEYS } from "@/hooks/use-shortcuts";
import { STATUS_LABEL } from "@/lib/labels";
import type { CheckStatus } from "@/server/model";

interface Cmd {
  id: string;
  group: "Actions" | "Navigation" | "Checks";
  label: string;
  hint?: string;
  keywords?: string;
  icon: ReactNode;
  run: () => void;
}

/** ⌘K / Ctrl K command menu, 560 px. Enter runs, Esc closes, arrows move. */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { meta, openComposer, openRateDialog } = useShell();
  const { nameFor } = useNicknames();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setIndex(0);
    }
  }, [open]);

  const commands = useMemo<Cmd[]>(() => {
    const close = (fn: () => void) => () => {
      onOpenChange(false);
      setTimeout(fn, 0);
    };
    const list: Cmd[] = [
      { id: "new", group: "Actions", label: "New payment check", hint: "C", icon: <Plus size={14} />, keywords: "create compose", run: close(() => openComposer()) },
      { id: "rate", group: "Actions", label: "Enter a USD/MXN rate", icon: <PenLine size={14} />, keywords: "update rate stale fx", run: close(() => openRateDialog()) },
    ];
    for (const c of meta?.checkRefs ?? []) {
      if (c.status === "awaiting_receipt" && !c.archived) {
        list.push({ id: `out-${c.id}`, group: "Actions", label: `Record outcome for ${c.id}`, hint: nameFor(c.supplierHash), icon: <FileCheck2 size={14} />, keywords: "received reply", run: close(() => router.push(`/checks/${c.id}/outcome`)) });
      }
    }
    for (const [k, v] of Object.entries(GO_KEYS)) {
      list.push({ id: `go-${k}`, group: "Navigation", label: `Go to ${v.label.toLowerCase()}`, hint: `G then ${k.toUpperCase()}`, icon: <ArrowRight size={14} />, run: close(() => router.push(v.href)) });
    }
    list.push({ id: "go-help", group: "Navigation", label: "Go to help & shortcuts", icon: <ArrowRight size={14} />, run: close(() => router.push("/help")) });
    list.push({ id: "go-settings", group: "Navigation", label: "Go to settings", icon: <ArrowRight size={14} />, run: close(() => router.push("/settings")) });
    for (const c of [...(meta?.checkRefs ?? [])].reverse()) {
      list.push({
        id: `chk-${c.id}`,
        group: "Checks",
        label: `${c.id} · ${nameFor(c.supplierHash)}`,
        hint: STATUS_LABEL[c.status as CheckStatus] + (c.archived ? " · archived" : ""),
        keywords: `#${c.supplierHash} ${c.supplierHash}`,
        icon: <Search size={14} />,
        run: close(() => router.push(`/checks/${c.id}`)),
      });
    }
    return list;
  }, [meta, nameFor, onOpenChange, openComposer, openRateDialog, router]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) {
      const checks = commands.filter((c) => c.group === "Checks").slice(0, 6);
      return [...commands.filter((c) => c.group !== "Checks"), ...checks];
    }
    const words = term.split(/\s+/);
    return commands.filter((c) => {
      const hay = `${c.label} ${c.keywords ?? ""} ${c.hint ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w) || hay.replace(/-/g, "").includes(w.replace(/-/g, "")));
    });
  }, [q, commands]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[index]?.run();
    }
  };

  let lastGroup = "";
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/50" />
        <RD.Content
          aria-label="Command menu"
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-[560px] -translate-x-1/2 animate-pop-in overflow-hidden rounded-[12px] border border-hairline-strong bg-raised shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
          onKeyDown={onKey}
        >
          <RD.Title className="sr-only">Command menu</RD.Title>
          <RD.Description className="sr-only">Type a command or search for a check. Enter runs, Esc closes.</RD.Description>
          <div className="flex items-center gap-2 border-b border-hairline px-4">
            <Search size={15} className="text-meta" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type a command or search…"
              aria-label="Type a command or search"
              role="combobox"
              aria-expanded="true"
              aria-controls="cmd-list"
              aria-activedescendant={filtered[index] ? `cmd-${filtered[index].id}` : undefined}
              className="h-12 flex-1 bg-transparent text-[14px] text-figure placeholder:text-meta focus-visible:outline-none"
            />
          </div>
          <div ref={listRef} id="cmd-list" role="listbox" className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
            {filtered.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-meta">No matching commands or checks.</div>}
            {filtered.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <div key={c.id}>
                  {header && <div className="px-2.5 pb-1 pt-2 text-xs text-meta">{header}</div>}
                  <div
                    id={`cmd-${c.id}`}
                    role="option"
                    aria-selected={i === index}
                    data-index={i}
                    onMouseMove={() => setIndex(i)}
                    onClick={c.run}
                    className={clsx("flex h-9 items-center gap-2.5 rounded-[7px] px-2.5 text-[13px]", i === index ? "bg-active text-figure" : "text-label")}
                  >
                    <span className="text-meta">{c.icon}</span>
                    <span className="flex-1 truncate">{c.label}</span>
                    {c.hint && <span className="shrink-0 text-xs text-meta">{c.hint}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-hairline px-4 py-2 text-xs text-meta">
            <span>↑↓ to move · Enter runs · Esc closes</span>
            <span>Ctrl K</span>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
