import { route, parseBody } from "@/server/http";
import { mutate, readDb } from "@/server/db";
import { createCheck } from "@/server/services/checks";
import { supplierIdFor } from "@/server/pseudonym";
import { listItem, type CheckListItem } from "@/server/views";
import { dec } from "@/engine";
import { createCheckSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const GET = route("read", async ({ req, auth, nowMs }) => {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "all";
  const db = await readDb(auth.scope);
  const items = db.checks
    .filter((c) => (scope === "mine" ? c.createdBy === db.currentUserId : true))
    .map((c) => listItem(db, c, nowMs))
    .sort((a, b) => b.id.localeCompare(a.id));
  return { items, summary: summarise(items.filter((i) => !i.archived)) };
});

export const POST = route("check:write", async ({ req, auth, ctx }) => {
  const { supplierToken, ...body } = await parseBody(req, createCheckSchema);
  // The browser sent an HMAC token, never the nickname. Re-key it with the server-only pepper.
  const supplierHash = supplierIdFor(auth.workspaceId, supplierToken);
  const check = await mutate(auth.scope, (db) => createCheck(db, { ...body, supplierHash }, ctx));
  return { id: check.id, status: check.status, calcError: check.calcError, supplierId: check.supplierHash };
});

const OPEN = new Set(["calc_failed", "draft", "choose_route", "reply_overdue", "awaiting_receipt"]);

/** Strip figures for list headers. Computed here so the UI never does financial arithmetic. */
function summarise(items: CheckListItem[]) {
  const sum = (cur: string) => items.reduce((a, i) => (i.shortfall?.currency === cur ? a.plus(dec(i.shortfall.value)) : a), dec(0)).toFixed();
  const rec = items.filter((i) => i.insideRange !== null);
  return {
    open: items.filter((i) => OPEN.has(i.group)).length,
    shortfallMxn: sum("MXN"),
    shortfallUsd: sum("USD"),
    awaiting: items.filter((i) => i.status === "awaiting_receipt").length,
    reconciled: rec.length,
    insideRange: rec.filter((i) => i.insideRange).length,
  };
}
export type ListSummary = ReturnType<typeof summarise>;
