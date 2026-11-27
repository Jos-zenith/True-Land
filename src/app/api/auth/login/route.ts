import { NextResponse } from "next/server";
import { parseBody, publicRoute } from "@/server/http";
import { login } from "@/server/auth/accounts";
import { createSession, sessionCookie, SESSION_TTL_MS } from "@/server/auth/session";
import { loginSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const POST = publicRoute(async (req, nowMs) => {
  const b = await parseBody(req, loginSchema);
  const { userId, workspaceId } = await login(b, nowMs);
  const token = await createSession(userId, workspaceId, nowMs);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.headers.append("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1000));
  return res;
});
