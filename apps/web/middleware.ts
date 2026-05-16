import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// These routes are publicly accessible — they validate access themselves
const PUBLIC_PATH_PREFIXES = ["/api/integrations", "/share/"];

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
      return NextResponse.next();
    }
    return new NextResponse("Unauthorized", { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json).*)"],
};
