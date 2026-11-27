import { NextResponse } from "next/server";
import { publicRoute } from "@/server/http";
import { clearCookie, readCookie, revokeSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export const POST = publicRoute(async (req, nowMs) => {
  await revokeSession(readCookie(req), nowMs);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.headers.append("Set-Cookie", clearCookie());
  return res;
});
