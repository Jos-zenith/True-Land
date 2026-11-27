import { NextResponse } from "next/server";
import { z } from "zod";
import { EngineError } from "@/engine";
import { zodFieldErrors } from "@/lib/schemas";
import { ServiceError } from "./core";
import type { Scope } from "./db";
import { InvariantError } from "./invariants";
import { HistoryViolation } from "./store/aggregate";
import { authorize, type Permission } from "./auth/authz";
import { readCookie, resolveSession } from "./auth/session";
import type { Access } from "./model";

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new ServiceError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request body as JSON.");
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ServiceError(400, "BAD_JSON", "The request body is not valid JSON.");
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    const fields = zodFieldErrors(r.error);
    throw new ServiceError(422, "VALIDATION", Object.values(fields)[0] ?? "Some fields need attention.", fields);
  }
  return r.data;
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ServiceError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, fields: e.fields, ...e.extra } }, { status: e.status, headers: { "Cache-Control": "no-store" } });
  }
  if (e instanceof EngineError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: 422 });
  }
  if (e instanceof InvariantError || e instanceof HistoryViolation) {
    console.error("[landed] integrity", e.message);
    return NextResponse.json({ error: { code: "INTEGRITY", message: "This change would break the check's recorded history, so it was not saved." } }, { status: 409 });
  }
  console.error("[landed] unhandled", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong on our side. Nothing was saved." } }, { status: 500 });
}

/**
 * CSRF defence for cookie-authenticated mutations: the request must come from this origin.
 * Browsers always send Origin on cross-origin POST/PUT/PATCH/DELETE; SameSite=Lax is a second layer.
 */
export function assertSameOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    let o: URL;
    try {
      o = new URL(origin);
    } catch {
      throw new ServiceError(403, "CSRF", "Cross-site request refused.");
    }
    if (!host || o.host !== host) throw new ServiceError(403, "CSRF", "Cross-site request refused.");
    return;
  }
  if (req.headers.get("sec-fetch-site") === "same-origin") return;
  throw new ServiceError(403, "CSRF", "Cross-site request refused.");
}

export interface Auth {
  userId: string;
  workspaceId: string;
  access: Access;
  scope: Scope;
}

export async function authenticate(req: Request, nowMs: number): Promise<Auth> {
  const s = await resolveSession(readCookie(req), nowMs);
  if (!s) throw new ServiceError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return { ...s, scope: { workspaceId: s.workspaceId, userId: s.userId } };
}

export interface RouteArgs<P> {
  req: Request;
  params: P;
  auth: Auth;
  nowMs: number;
  /** Service context: the authenticated user is always the actor. */
  ctx: { actor: string; nowMs: number };
}

export type RouteCtx<P> = { params: Promise<P> };

/**
 * Authenticated route: session -> permission -> same-origin (mutations) -> handler.
 * Unauthenticated requests get 401 before any data is read.
 */
export function route<P = Record<string, never>>(permission: Permission, fn: (a: RouteArgs<P>) => Promise<unknown> | unknown) {
  return async (req: Request, rc?: RouteCtx<P>) => {
    try {
      const nowMs = Date.now();
      const auth = await authenticate(req, nowMs);
      authorize(auth.access, permission);
      assertSameOrigin(req);
      const params = (rc ? await rc.params : {}) as P;
      const data = await fn({ req, params, auth, nowMs, ctx: { actor: auth.userId, nowMs } });
      if (data instanceof Response) return data;
      return NextResponse.json(data ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Unauthenticated route (sign-in, sign-up). Still same-origin for mutations. */
export function publicRoute(fn: (req: Request, nowMs: number) => Promise<unknown> | unknown) {
  return async (req: Request) => {
    try {
      assertSameOrigin(req);
      const data = await fn(req, Date.now());
      if (data instanceof Response) return data;
      return NextResponse.json(data ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
