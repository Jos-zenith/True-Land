import { route } from "@/server/http";
import { resetDemoWorkspace } from "@/server/db";
import { demoActors } from "@/server/auth/accounts";
import { buildSeed } from "@/server/seed";

export const dynamic = "force-dynamic";

/** Admin only, demo workspaces only (also enforced by the database). Purges demo history and re-seeds. */
export const POST = route("demo:reset", async ({ auth, nowMs }) => {
  const { owner, persona } = await demoActors(auth.workspaceId);
  await resetDemoWorkspace(auth.scope, (key) => buildSeed(nowMs, { workspaceId: auth.workspaceId, pseudonymKey: key, owner, persona }), nowMs);
  return { ok: true };
});
