"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";
import {
  CircleDashed,
  CircleOff,
  FileText,
  MessageSquareText,
  PenLine,
  Quote,
  Radio,
  ShieldCheck,
} from "lucide-react";
import type { SourceClass } from "@/engine/types";
import type { EvidenceLevel } from "@/server/model";
import type { Chip as ChipModel, ListGroup, Tone } from "@/server/views";
import { EVIDENCE_HELP, EVIDENCE_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { Tip } from "./overlay";

const toneColor: Record<Tone, string> = {
  short: "var(--color-short)",
  warn: "var(--color-warn)",
  ok: "var(--color-ok)",
  neutral: "var(--color-meta)",
  error: "var(--color-bad)",
  info: "var(--color-info)",
};

export function Glyph({ glyph, tone }: { glyph: ChipModel["glyph"]; tone: Tone }) {
  const c = toneColor[tone];
  if (glyph === "none") return null;
  if (glyph === "ring") return <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full border-[1.5px]" style={{ borderColor: tone === "neutral" ? "var(--color-label)" : c }} />;
  if (glyph === "square") return <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-[1px]" style={{ background: tone === "neutral" ? "var(--color-label)" : c }} />;
  if (glyph === "half")
    return (
      <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
        <circle cx="5" cy="5" r="4" fill="none" stroke={c} strokeWidth="1.5" />
        <path d="M5 1a4 4 0 0 1 0 8z" fill={c} />
      </svg>
    );
  return <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: tone === "neutral" ? "var(--color-label)" : c }} />;
}

/** 24px chip: dot or ring plus a word. Colour lives in the glyph; the text stays neutral. */
export function Chip({ chip, className }: { chip: ChipModel; className?: string }) {
  const body = (
    <span
      className={clsx(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-hairline-strong px-2 text-xs font-[510] text-label",
        className,
      )}
    >
      <Glyph glyph={chip.glyph} tone={chip.tone} />
      {chip.text}
    </span>
  );
  return chip.title ? <Tip content={chip.title}>{body}</Tip> : body;
}

export function PlainChip({ children, className, tone = "neutral", glyph = "none" }: { children: ReactNode; className?: string; tone?: Tone; glyph?: ChipModel["glyph"] }) {
  return (
    <span className={clsx("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-hairline-strong px-2 text-xs font-[510] text-label", className)}>
      <Glyph glyph={glyph} tone={tone} />
      {children}
    </span>
  );
}

export function EvidenceChip({ level, className }: { level: EvidenceLevel; className?: string }) {
  const glyph = level === "modelled" ? "ring" : level === "tax_record" ? "square" : "dot";
  const tone: Tone = level === "verified" ? "ok" : "neutral";
  return (
    <Tip content={EVIDENCE_HELP[level]}>
      <span className={clsx("inline-flex h-6 items-center gap-1.5 rounded-full border border-hairline-strong px-2 text-xs font-[510] text-label", className)}>
        <Glyph glyph={glyph} tone={tone} />
        {EVIDENCE_LABEL[level]}
        {level === "verified" && <span className="text-meta">· system</span>}
      </span>
    </Tip>
  );
}

/** Inline evidence word with glyph, for tables. */
export function EvidenceWord({ level }: { level: EvidenceLevel }) {
  const glyph = level === "modelled" ? "ring" : level === "tax_record" ? "square" : "dot";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Glyph glyph={glyph} tone={level === "verified" ? "ok" : "neutral"} />
      {EVIDENCE_LABEL[level]}
    </span>
  );
}

const SOURCE_ICON: Record<SourceClass, { icon: typeof PenLine; color: string }> = {
  live: { icon: Radio, color: "var(--color-ok)" },
  published: { icon: FileText, color: "var(--color-label)" },
  provider_quote: { icon: Quote, color: "var(--color-info)" },
  manual: { icon: PenLine, color: "var(--color-label)" },
  modelled: { icon: CircleDashed, color: "var(--color-label)" },
  supplier_reported: { icon: MessageSquareText, color: "var(--color-label)" },
  payer_reported: { icon: MessageSquareText, color: "var(--color-label)" },
  bank_confirmed: { icon: ShieldCheck, color: "var(--color-ok)" },
  unavailable: { icon: CircleOff, color: "var(--color-warn)" },
};

/** Provenance badge. Each classification has its own icon and word, so they are never confused. */
export function SourceBadge({ cls, demo, compact }: { cls: SourceClass; demo?: boolean; compact?: boolean }) {
  const { icon: Icon, color } = SOURCE_ICON[cls];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-label">
      <Icon aria-hidden size={13} strokeWidth={1.75} style={{ color }} />
      {!compact && SOURCE_LABEL[cls]}
      {demo && <span className="text-meta">· demo</span>}
    </span>
  );
}

const GROUP_GLYPH: Record<ListGroup, ReactNode> = {
  draft: (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--color-meta)" strokeWidth="1.5" strokeDasharray="2.2 2" />
    </svg>
  ),
  calc_failed: (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--color-bad)" strokeWidth="1.5" />
      <path d="M5 5l4 4M9 5l-4 4" stroke="var(--color-bad)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  choose_route: (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--color-label)" strokeWidth="1.5" />
    </svg>
  ),
  awaiting_receipt: (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--color-warn)" strokeWidth="1.5" />
      <path d="M7 3a4 4 0 0 1 0 8z" fill="var(--color-warn)" />
    </svg>
  ),
  reply_overdue: (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--color-short)" strokeWidth="1.5" />
      <path d="M7 4v3.4" stroke="var(--color-short)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="9.6" r="0.9" fill="var(--color-short)" />
    </svg>
  ),
  no_reply: (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--color-meta)" strokeWidth="1.5" />
      <path d="M4.6 7h4.8" stroke="var(--color-meta)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  refused: (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--color-meta)" strokeWidth="1.5" />
      <path d="M3.2 10.8l7.6-7.6" stroke="var(--color-meta)" strokeWidth="1.5" />
    </svg>
  ),
  reconciled: (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle cx="7" cy="7" r="6" fill="var(--color-accent)" />
      <path d="M4.4 7.2l1.8 1.8 3.5-3.7" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

export function StatusIcon({ group, className }: { group: ListGroup; className?: string }) {
  return <span className={clsx("inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center", className)}>{GROUP_GLYPH[group]}</span>;
}
