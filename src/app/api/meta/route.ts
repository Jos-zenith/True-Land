import { route } from "@/server/http";
import { readDb, workspaceKey } from "@/server/db";
import { currentRate, currentSchedule } from "@/server/core";
import { inbox } from "@/server/views";
import { demoNicknames } from "@/server/seed";
import { PROVIDERS } from "@/server/demo-data";
import { liveVerifierConfigured } from "@/server/verification";
import { MATRIX } from "@/server/auth/authz";
import { FRESHNESS, rateFreshness, CALC_VERSION } from "@/engine";
import { ymd } from "@/lib/format";

export const dynamic = "force-dynamic";

export const GET = route("read", async ({ auth, nowMs }) => {
  const db = await readDb(auth.scope);
  const rate = currentRate(db);
  const sched = currentSchedule(db);
  const user = db.users.find((u) => u.id === db.currentUserId)!;
  const key = await workspaceKey(auth.workspaceId);
  return {
    workspace: db.workspace,
    user,
    /** Permissions of the signed-in user, for UI affordances only. The server enforces them on every call. */
    permissions: Object.fromEntries(Object.entries(MATRIX).map(([p, roles]) => [p, roles.includes(auth.access)])),
    /** Per-workspace key the browser uses to derive supplier tokens. Members only; never the server pepper. */
    pseudonymKey: key,
    seededAt: db.seededAt,
    today: ymd(nowMs),
    now: nowMs,
    calcVersion: CALC_VERSION,
    rate: rate ? { ...rate, ...rateFreshness(rate.retrievedAt, nowMs) } : null,
    schedule: { version: sched.version, publishedAt: sched.publishedAt },
    inboxCount: inbox(db, nowMs).length,
    providers: PROVIDERS,
    freshness: FRESHNESS,
    verification: { demo: db.workspace.isDemo, live: liveVerifierConfigured() },
    demoNicknames: db.workspace.isDemo ? demoNicknames(db.workspace.id, key) : {},
    checkRefs: db.checks.map((c) => ({ id: c.id, supplierHash: c.supplierHash, status: c.status, archived: c.archived })),
  };
});
