import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/server/auth/cookie";

/**
 * Optimistic routing only — NOT a security boundary (docs/SYSTEM_ARCHITECTURE.md §4).
 * - No session cookie on a private page → send to sign-in, remembering where they were going.
 * - On normal page navigations, slide the cookie's expiry forward (the database decides
 *   whether the session is actually valid, on every request, in the data layer).
 */

const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!token && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  // Only on GET: a Server Action (POST) may itself be setting or clearing the cookie.
  if (token && request.method === "GET") {
    response.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  }
  return response;
}

export const config = {
  // `api/capture` (the capture upload) is skipped: for requests the proxy sees, Next.js buffers
  // the body and reads all of it before the route runs, which would defeat the route's
  // upload limit. The route checks the session itself.
  matcher: ["/((?!_next/static|_next/image|brand/|icon.png|apple-icon.png|favicon.ico|robots.txt|api/capture/?$).*)"],
};
