"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { fmtMoney, fmtSignedMoney } from "@/lib/format";

export function Money({ value, currency, dp = 0, className }: { value: string | number | null | undefined; currency: string; dp?: number; className?: string }) {
  return <span className={clsx("tnum whitespace-nowrap", className)}>{fmtMoney(value, currency, dp)}</span>;
}

/** Signed variance. Adverse (negative) values carry the variance colour on a glyph, not the whole sentence. */
export function Variance({ value, currency, dp = 0, adverseWhen = "negative", className }: { value: string | null | undefined; currency?: string; dp?: number; adverseWhen?: "negative" | "positive" | "never"; className?: string }) {
  if (value === null || value === undefined) return <span className="text-meta">—</span>;
  const n = Number(value);
  const adverse = adverseWhen === "negative" ? n < 0 : adverseWhen === "positive" ? n > 0 : false;
  const text = currency ? fmtSignedMoney(value, currency, dp) : fmtSignedMoney(value, "", dp).replace(/^([+−]?) /, "$1");
  return (
    <span className={clsx("tnum inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      {adverse && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-short" />}
      {text}
    </span>
  );
}

/** Stat cell: label, key figure (24/590), and a qualifier such as the evidence level. */
export function StatCell({ label, value, sub, muted, emphasis }: { label: ReactNode; value: ReactNode; sub?: ReactNode; muted?: boolean; emphasis?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="text-[13px] text-meta">{label}</div>
      <div className={clsx("figure mt-1 whitespace-nowrap text-[20px] font-[590] leading-tight @3xl:text-[24px]", muted ? "text-meta" : "text-figure", emphasis && "text-figure")}>{value}</div>
      {sub && <div className="mt-1 text-[13px] text-meta">{sub}</div>}
    </div>
  );
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 }) {
  return (
    // Container query: four columns only when the grid itself is wide enough, whatever the viewport.
    <div className="@container">
      <div className={clsx("grid grid-cols-2 gap-px overflow-hidden rounded-[9px] border border-hairline bg-hairline [&>*]:bg-panel", cols === 4 ? "@2xl:grid-cols-4" : "@xl:grid-cols-3")}>
        {children}
      </div>
    </div>
  );
}
