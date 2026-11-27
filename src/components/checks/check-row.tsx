"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clsx } from "clsx";
import { Archive, ArchiveRestore, Copy, CopyPlus, FileCheck2, MoreHorizontal, SquareArrowOutUpRight } from "lucide-react";
import type { CheckListItem } from "@/server/views";
import { Chip, StatusIcon } from "@/components/ui/chip";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiError } from "@/hooks/use-api";
import { useNicknames } from "@/hooks/use-nicknames";
import { fmtDay, fmtMoney } from "@/lib/format";

export function useCheckActions() {
  const router = useRouter();
  const toast = useToast();
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong. Nothing was changed.");
    }
  };
  return {
    duplicate: (id: string) =>
      run(async () => {
        const r = await apiSend<{ id: string }>("POST", `/api/checks/${id}/duplicate`);
        toast.success(`Duplicated ${id} as ${r.id}, estimated with the current rate.`);
        router.push(`/checks/${r.id}/compare`);
      }),
    archive: (id: string, archived: boolean) =>
      run(async () => {
        await apiSend("POST", `/api/checks/${id}/${archived ? "restore" : "archive"}`);
        toast.success(archived ? `${id} restored.` : `${id} archived. The record is kept.`, archived ? undefined : { label: "Undo", onClick: () => void apiSend("POST", `/api/checks/${id}/restore`) });
      }),
    copyRequest: (text: string) =>
      run(async () => {
        await navigator.clipboard.writeText(text);
        toast.success("Request copied. Paste it into your message to the supplier.");
      }),
  };
}

export function supplierRequestText(p: { id: string; route: string | null; sendAmount: string; currency: string; paidOn?: string | null }) {
  return [
    `Hello,`,
    ``,
    `We sent ${fmtMoney(p.sendAmount, "USD", 2)}${p.route ? ` via ${p.route}` : ""}${p.paidOn ? ` on ${fmtDay(p.paidOn)}` : ""} (our reference ${p.id}).`,
    `Could you tell us the exact amount in ${p.currency} that reached your account, and the date it arrived?`,
    `If you have the SPEI receipt (CEP) or a bank credit advice, please attach it.`,
    ``,
    `Thank you.`,
  ].join("\n");
}

export function RowMenu({ item, open, onOpenChange }: { item: CheckListItem; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const router = useRouter();
  const actions = useCheckActions();
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger asChild>
        <button
          aria-label={`Actions for ${item.id}`}
          onClick={(e) => e.stopPropagation()}
          className="flex h-6 w-6 items-center justify-center rounded-[5px] text-meta opacity-0 transition-opacity hover:bg-active hover:text-label focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal size={15} />
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={<SquareArrowOutUpRight size={14} />} onSelect={() => router.push(`/checks/${item.id}`)}>
          Open check
        </MenuItem>
        <MenuItem icon={<FileCheck2 size={14} />} disabled={!(item.status === "awaiting_receipt" || item.status === "no_reply") || item.archived} onSelect={() => router.push(`/checks/${item.id}/outcome`)}>
          Record outcome
        </MenuItem>
        <MenuItem icon={<CopyPlus size={14} />} onSelect={() => actions.duplicate(item.id)}>
          Duplicate as new check
        </MenuItem>
        <MenuItem
          icon={<Copy size={14} />}
          disabled={!item.routeLabel}
          onSelect={() => actions.copyRequest(supplierRequestText({ id: item.id, route: item.routeLabel, sendAmount: item.sendAmount, currency: item.expected?.currency ?? item.invoice.currency }))}
        >
          Copy request to supplier
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={item.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} onSelect={() => actions.archive(item.id, item.archived)}>
          {item.archived ? "Restore" : "Archive (record is kept)"}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** 40 px list row. Click opens the check; right-click or ··· opens the row menu. */
export function CheckRow({ item, showStatusIcon, dateMode = "payBy", compact }: { item: CheckListItem; showStatusIcon?: boolean; dateMode?: "payBy" | "updated"; compact?: boolean }) {
  const { nameFor } = useNicknames();
  const [menu, setMenu] = useState(false);
  const desc =
    item.invoice.currency === "USD"
      ? `${fmtMoney(item.invoice.amount, "USD")} invoice, USD wire`
      : `${fmtMoney(item.invoice.amount, item.invoice.currency)} invoice${item.routeLabel ? ` · ${item.routeLabel}` : ", paid in USD"}`;
  const value = item.actual ?? item.expected;
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
      className={clsx("group relative flex min-h-10 items-center gap-3 border-b border-hairline pl-4 pr-2 transition-colors duration-100 hover:bg-hover md:pl-6", item.archived && "opacity-60")}
    >
      <Link href={`/checks/${item.id}`} className="absolute inset-0 z-0" aria-label={`Open ${item.id}, ${nameFor(item.supplierHash)}, ${item.statusLabel}`} />
      {showStatusIcon && <StatusIcon group={item.group} className="relative z-[1] pointer-events-none" />}
      <span className="tnum pointer-events-none relative z-[1] w-[64px] shrink-0 whitespace-nowrap text-[13px] text-meta">{item.id}</span>
      <div className="pointer-events-none relative z-[1] flex min-w-0 flex-1 flex-col py-2 sm:flex-row sm:items-center sm:gap-3 sm:py-0">
        <span className="truncate text-[13px] font-[510] text-figure sm:max-w-[160px] sm:shrink-0">{nameFor(item.supplierHash)}</span>
        <span className="truncate text-[13px] text-meta">
          {desc}
          {item.archived && " · archived"}
        </span>
      </div>
      <div className={clsx("pointer-events-none relative z-[1] hidden shrink-0 items-center gap-1.5", compact ? "2xl:flex" : "xl:flex")}>
        {item.chips.slice(0, compact ? 1 : 3).map((c, i) => (
          <Chip key={i} chip={c} />
        ))}
      </div>
      <span className="tnum pointer-events-none relative z-[1] hidden w-[118px] shrink-0 text-right text-[13px] font-[510] text-figure sm:block">
        {value ? fmtMoney(value.value, value.currency) : <span className="text-meta">—</span>}
      </span>
      <span className="tnum pointer-events-none relative z-[1] hidden w-[92px] shrink-0 text-right text-[13px] text-meta md:block">
        {dateMode === "payBy" ? `Pay by ${fmtDay(item.payBy)}` : fmtDay(item.updatedAt)}
      </span>
      <div className="relative z-[2]">
        <RowMenu item={item} open={menu} onOpenChange={setMenu} />
      </div>
    </div>
  );
}
