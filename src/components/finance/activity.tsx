"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { fmtStamp } from "@/lib/format";

export interface ActivityEvent {
  id: string;
  at: string;
  actor: string;
  actorName: string;
  type: string;
  message: string;
  checkId?: string | null;
}

const VERB_TYPES = new Set(["created", "draft_saved", "note"]);

/** Audit event rows. Entries are never edited or removed; a correction adds a new entry. */
export function ActivityList({ events, showCheck, dense }: { events: ActivityEvent[]; showCheck?: boolean; dense?: boolean }) {
  return (
    <ol className="flex flex-col">
      {events.map((e) => {
        const isSystem = e.actor === "system";
        const verb = VERB_TYPES.has(e.type);
        return (
          <li key={e.id} className={clsx("flex gap-3 text-[13px] leading-relaxed", dense ? "py-1" : "py-1.5")}>
            <span aria-hidden className={clsx("mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full", e.type === "calc_failed" ? "bg-bad" : e.type.startsWith("outcome") || e.type === "evidence_checked" ? "bg-label" : "bg-deco")} />
            <p className="min-w-0 flex-1 text-meta">
              {showCheck && e.checkId && (
                <Link href={`/checks/${e.checkId}`} className="mr-1.5 font-[510] text-label hover:text-figure">
                  {e.checkId}
                </Link>
              )}
              {e.type === "note" ? (
                <>
                  <span className="font-[510] text-label">{e.actorName}</span> noted: <span className="text-label">“{e.message}”</span>
                </>
              ) : verb ? (
                <>
                  <span className="font-[510] text-label">{e.actorName}</span> {e.message}
                </>
              ) : (
                <>
                  {e.message}
                  {!isSystem && <span className="text-meta"> · {e.actorName}</span>}
                </>
              )}
              <span className="tnum whitespace-nowrap text-meta"> · {fmtStamp(e.at)}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
