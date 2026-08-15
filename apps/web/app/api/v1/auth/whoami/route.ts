import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireSession } from "@/lib/session";
import { extractBearerToken } from "@/lib/auth";
import { withApiErrors } from "@/lib/api/respond";
import { getOidcConfig } from "@/lib/oidc";

export const dynamic = "force-dynamic";

/**
 * Diagnostic endpoint: who does the server think you are, and how did it work
 * that out? Exists so the OIDC setup can be verified with curl before any
 * native client exists, and so a failing device can be debugged in one request.
 *
 * Returns 401 through the standard envelope when the token is bad, which is
 * the same failure any other /api/v1 route would give.
 */
export const GET = withApiErrors(async () => {
  const headerList = await headers();
  const transport =
    extractBearerToken(headerList.get("authorization")) !== null
      ? "bearer"
      : "proxy_headers";

  const session = await requireSession();

  return NextResponse.json({
    transport,
    oidcConfigured: getOidcConfig() !== null,
    user: {
      username: session.user.username,
      displayName: session.user.displayName,
      groups: session.user.groups,
    },
    household: {
      householdId: session.householdId,
      memberId: session.memberId,
      role: session.role,
    },
  });
});
