import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Integration API routes use bearer token auth — skip Authelia header check
const INTEGRATION_PATH_PREFIX = "/api/integrations";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function middleware(request: NextRequest) {
  // Let integration API routes through — they verify tokens themselves
  if (request.nextUrl.pathname.startsWith(INTEGRATION_PATH_PREFIX)) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
    }
    const response = NextResponse.next();
    Object.entries(CORS_HEADERS).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  const autheliaUser = request.headers.get(
    process.env.AUTHELIA_USER_HEADER ?? "Remote-User"
  );

  if (!autheliaUser) {
    // In development without Authelia, allow through with a fallback identity
    if (process.env.NODE_ENV === "development") {
      return NextResponse.next();
    }
    return new NextResponse("Unauthorized", { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json).*)"],
};
