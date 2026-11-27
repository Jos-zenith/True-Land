import { NextResponse, type NextRequest } from "next/server";

/**
 * UX only: send visitors without a session cookie to the sign-in page. This is NOT the security
 * boundary (it cannot validate the session at the edge). Every API route and server-rendered page
 * validates the session against the database and checks permissions itself.
 */
const PUBLIC = ["/login", "/signup", "/api/", "/_next/", "/icon.svg", "/favicon.ico"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  const name = process.env.NODE_ENV === "production" ? "__Host-landed_session" : "landed_session";
  if (req.cookies.get(name)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
