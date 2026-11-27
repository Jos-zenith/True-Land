"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Inbox as InboxIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/layout";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/field";
import { useApi } from "@/hooks/use-api";
import { useNicknames } from "@/hooks/use-nicknames";
import { fmtAgo } from "@/lib/format";
import type { InboxItem } from "@/server/views";

const DOT: Record<string, string> = {
  short: "bg-short",
  warn: "bg-warn",
  error: "bg-bad",
  neutral: "border border-label",
  ok: "bg-ok",
  info: "bg-info",
};

export default function InboxPage() {
  const { data, error, loading, reload } = useApi<{ items: InboxItem[] }>("/api/inbox");
  const { nameFor } = useNicknames();
  const [kind, setKind] = useState("all");
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), [data]);
  const items = useMemo(() => data?.items ?? [], [data]);
  const kinds = useMemo(() => [...new Set(items.map((i) => i.kind))], [items]);
  const shown = kind === "all" ? items : items.filter((i) => i.kind === kind);

  return (
    <>
      <PageHeader crumbs={[{ label: "Inbox" }]}>
        <span className="tnum text-[13px] text-meta">{data ? items.length : ""}</span>
      </PageHeader>
      {items.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-hairline px-4 py-2 no-scrollbar md:px-6">
          <Segmented
            size="sm"
            label="Filter inbox"
            value={kind}
            onChange={setKind}
            options={[{ value: "all", label: `All ${items.length}` }, ...kinds.map((k) => ({ value: k, label: `${k} ${items.filter((i) => i.kind === k).length}` }))]}
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : loading ? (
          <SkeletonRows rows={5} />
        ) : shown.length === 0 ? (
          <EmptyState icon={<InboxIcon size={20} />} title="Nothing needs you." body="Overdue replies, stale rates, failed calculations, incomplete evidence and unusual variances will appear here." />
        ) : (
          <ul>
            {shown.map((i) => (
              <li key={i.id}>
                <Link href={i.href} className="group flex items-start gap-3 border-b border-hairline px-4 py-3 transition-colors hover:bg-hover md:px-6">
                  <span aria-hidden className={clsx("mt-[7px] h-2 w-2 shrink-0 rounded-full", DOT[i.tone])} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-[590] text-figure">
                      {i.checkId} · {i.title}
                    </div>
                    <div className="mt-0.5 text-[13px] text-meta">
                      <span className="text-label">{nameFor(i.supplierHash)}</span> · {i.body}
                    </div>
                  </div>
                  <span className="hidden shrink-0 rounded-[4px] border border-hairline-strong px-1.5 text-[11px] text-meta sm:inline">{i.kind}</span>
                  <span className="tnum w-12 shrink-0 text-right text-[13px] text-meta">{now ? fmtAgo(i.at, now) : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="shrink-0 border-t border-hairline px-4 py-2 text-xs text-meta md:px-6">Items clear themselves when the underlying check is resolved.</div>
    </>
  );
}
