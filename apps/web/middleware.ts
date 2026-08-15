import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// These routes are publicly accessible — they validate access themselves.
// /api/v1 is the client API: every handler calls requireSession(), which
// resolves either an OIDC access token or the Authelia proxy headers, and
// returns 401 through the shared error envelope when neither is present.
const PUBLIC_PATH_PREFIXES = ["/api/integrations", "/api/v1", "/share/"];

/**
 * Browser-facing alias for the client API.
 *
 * /api/v1 is bypassed at the reverse proxy so native clients can reach it with
 * a bearer token — but a bypassed request also arrives with no Remote-* headers,
 * which makes /api/v1 effectively bearer-only. The browser has a session, not a
 * token.
 *
 * /api/web is deliberately NOT in the bypass list, so Authelia authenticates it
 * and injects the identity headers, and we then rewrite it onto the same
 * handlers. One API, two doors: token through the front, session through the
 * side. No route code knows the difference — requireSession() already accepts
 * either.
 */
const WEB_API_PREFIX = "/api/web/";
const CLIENT_API_PREFIX = "/api/v1/";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let public routes through — they verify access themselves
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
    // Handle CORS preflight (integration API only)
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
    }
    const response = NextResponse.next();
    if (pathname.startsWith("/api/integrations")) {
      Object.entries(CORS_HEADERS).forEach(([k, v]) => response.headers.set(k, v));
    }
    return response;
  }

  const autheliaUser = request.headers.get(
    process.env.AUTHELIA_USER_HEADER ?? "Remote-User"
  );

  if (!autheliaUser) {
    // In development without Authelia, allow through with a fallback identity
    if (process.env.NODE_ENV === "development") {
      return rewriteWebApi(request) ?? NextResponse.next();
    }
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Authenticated by this point, so the identity headers are present and the
  // rewritten handler can resolve a member from them.
  return rewriteWebApi(request) ?? NextResponse.next();
}

/** Rewrites /api/web/* onto /api/v1/*, or null when the path isn't ours. */
function rewriteWebApi(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith(WEB_API_PREFIX)) return null;

  const url = request.nextUrl.clone();
  url.pathname = CLIENT_API_PREFIX + pathname.slice(WEB_API_PREFIX.length);
  return NextResponse.rewrite(url);
}

export const config = {
  // Exclude Next.js internals and all PWA/static public assets from auth check
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|sw\\.js).*)",
  ],
};
