import { route, parseBody } from "@/server/http";
import { addMember, listMembers } from "@/server/auth/accounts";
import { memberSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const GET = route("read", async ({ auth }) => ({ items: await listMembers(auth.workspaceId) }));

/** Admin adds a member to THEIR workspace only. The workspace comes from the session, never the body. */
export const POST = route("members:manage", async ({ req, auth }) => {
  const b = await parseBody(req, memberSchema);
  return addMember(auth.workspaceId, b);
});
