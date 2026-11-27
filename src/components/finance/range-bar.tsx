"use client";

import { clsx } from "clsx";

export interface Scale {
  min: number;
  max: number;
}

/** Shared scale for several ranges plus the invoice line, padded and rounded to a readable step. */
export function sharedScale(values: (string | number | null | undefined)[]): Scale {
  const nums = values.filter((v) => v !== null && v !== undefined).map(Number).filter(Number.isFinite);
  if (!nums.length) return { min: 0, max: 1 };
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  const span = Math.max(max - min, Math.abs(max) * 0.002, 1);
  min -= span * 0.12;
  max += span * 0.12;
  const step = Math.pow(10, Math.floor(Math.log10(span / 2)));
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step };
}

const pct = (v: number, s: Scale) => Math.min(100, Math.max(0, ((v - s.min) / (s.max - s.min)) * 100));

/**
 * Range bar: low–high band, a tick at typical, and a dashed line at the invoice.
 * The figures are always repeated as text next to it (wireframe: "text always repeated").
 * A rough estimate has no floor: the band fades out to the left.
 */
export function RangeBar({
  low,
  typical,
  high,
  invoice,
  scale,
  tone = "neutral",
  label,
  actual,
}: {
  low: string | null;
  typical: string;
  high: string;
  invoice: string | null;
  scale: Scale;
  tone?: "accent" | "neutral" | "ok";
  label: string;
  /** Observed amount, drawn as a distinct diamond marker (reconciliation). */
  actual?: string | null;
}) {
  const t = pct(Number(typical), scale);
  const h = pct(Number(high), scale);
  const l = low === null ? 0 : pct(Number(low), scale);
  const inv = invoice === null ? null : pct(Number(invoice), scale);
  const color = tone === "accent" ? "var(--color-accent)" : tone === "ok" ? "var(--color-accent)" : "#5a5e66";
  return (
    <div role="img" aria-label={label} className="relative h-4 w-full">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-hairline-strong" />
      {inv !== null && (
        <div className="absolute top-0 h-4 border-l border-dashed border-meta/70" style={{ left: `${inv}%` }} aria-hidden title="Invoice" />
      )}
      <div
        className={clsx("absolute top-1/2 h-[7px] -translate-y-1/2 rounded-full", low === null && "rounded-l-none")}
        style={{
          left: `${l}%`,
          width: `${Math.max(h - l, 0.8)}%`,
          background: low === null ? `linear-gradient(90deg, transparent 0%, ${color} ${Math.max(5, ((t - l) / Math.max(h - l, 1)) * 100)}%, ${color} 100%)` : color,
        }}
        aria-hidden
      />
      <div className="absolute top-1/2 h-[13px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-figure" style={{ left: `${t}%` }} aria-hidden />
      {actual !== undefined && actual !== null && (
        <div
          className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border-2 border-panel bg-short"
          style={{ left: `${pct(Number(actual), scale)}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}
