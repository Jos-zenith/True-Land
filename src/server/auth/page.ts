import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Scope } from "../db";
import { cookieName, resolveSession, type SessionInfo } from "./session";

/** Server components: resolve the session from the cookie or redirect to sign-in. */
export async function requirePageSession(nextPath: string): Promise<SessionInfo & { scope: Scope }> {
  const jar = await cookies();
  const raw = jar.get(cookieName())?.value ?? null;
  const token = raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
  const s = await resolveSession(token, Date.now());
  if (!s) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return { ...s, scope: { workspaceId: s.workspaceId, userId: s.userId } };
}
