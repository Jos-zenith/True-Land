import { route, parseBody } from "@/server/http";
import { mutate, readDb } from "@/server/db";
import { currentSchedule } from "@/server/core";
import { discardDraft, getDraft, previewDraft, saveDraft, scheduleSummary } from "@/server/services/fees";
import { feeDraftSchema } from "@/lib/schemas";
import { PROVIDERS } from "@/server/demo-data";
import type { Database } from "@/server/model";
import type { FeeRule } from "@/engine";

export const dynamic = "force-dynamic";

function state(db: Database, nowMs: number) {
  const current = currentSchedule(db);
  return {
    current,
    draft: getDraft(db),
    hasDraft: !!db.feeDraft && db.feeDraft.basedOn === current.version,
    preview: previewDraft(db, nowMs),
    versions: scheduleSummary(db).map((v) => ({ ...v, publishedByName: db.users.find((u) => u.id === v.publishedBy)?.name ?? "" })),
    providers: PROVIDERS,
    canEdit: !!db.users.find((u) => u.id === db.currentUserId)?.isAdmin,
  };
}
export type FeesState = ReturnType<typeof state>;

export const GET = route("read", async ({ auth, nowMs }) => state(await readDb(auth.scope), nowMs));

export const PUT = route("fees:write", async ({ req, auth, ctx, nowMs }) => {
  const b = await parseBody(req, feeDraftSchema);
  await mutate(auth.scope, (db) => saveDraft(db, b.rules as FeeRule[], ctx));
  return state(await readDb(auth.scope), nowMs);
});

export const DELETE = route("fees:write", async ({ auth, ctx, nowMs }) => {
  await mutate(auth.scope, (db) => discardDraft(db, ctx));
  return state(await readDb(auth.scope), nowMs);
});
