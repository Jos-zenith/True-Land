import { NextResponse } from "next/server";
import { parseBody, publicRoute } from "@/server/http";
import { signup } from "@/server/auth/accounts";
import { createSession, sessionCookie, SESSION_TTL_MS } from "@/server/auth/session";
import { signupSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Creates a user and their own workspace with labelled sample data. Disabled with LANDED_SIGNUP=closed. */
export const POST = publicRoute(async (req, nowMs) => {
  const b = await parseBody(req, signupSchema);
  const { userId, workspaceId } = await signup(b, nowMs);
  const token = await createSession(userId, workspaceId, nowMs);
  const res = NextResponse.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  res.headers.append("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1000));
  return res;
});
