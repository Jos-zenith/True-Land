import { NextResponse } from "next/server";
import { route } from "@/server/http";
import { ServiceError } from "@/server/core";
import { getPayload, payloadVisibleTo } from "@/server/integrations/store";

export const dynamic = "force-dynamic";

/**
 * The exact provider response behind an observation or quote, for evidence inspection. Market-data
 * payloads are visible to any signed-in user; quote payloads only to the workspace that requested them.
 */
export const GET = route<{ hash: string }>("read", async ({ params, auth }) => {
  if (!/^[0-9a-f]{64}$/.test(params.hash) || !(await payloadVisibleTo(auth.workspaceId, params.hash))) {
    throw new ServiceError(404, "NOT_FOUND", "No such evidence.");
  }
  const p = (await getPayload(params.hash))!;
  return new NextResponse(p.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-landed-provider": p.provider,
      "x-landed-received-at": new Date(p.received_at).toISOString(),
      "x-landed-sha256": p.hash,
    },
  });
});
