import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { AuthError, ForbiddenError, extractBearerToken } from "@/lib/auth";
import { requireSession } from "@/lib/session";
import { resolveToken } from "@/lib/integration-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOidcConfig } from "@/lib/oidc";
import { publicOrigin } from "@/lib/public-origin";
import { buildDishesMcpServer, type McpCaller } from "@/lib/mcp/dishes-mcp";
import { mcpResourceMetadataUrl } from "@/lib/mcp/oauth-resource";

/**
 * What someone signed in through Authelia (a claude.ai connector) may do: the
 * eating-out tools, as themselves. Integration tokens keep their own scopes.
 */
const SIGNED_IN_SCOPES = ["read:preferences", "read:meal_plan", "write:outside_meals"];

/**
 * 401 that tells an MCP client where to sign in (RFC 9728 `resource_metadata`)
 * when OIDC is set up; otherwise a plain one — use an integration token.
 */
function unauthorized(req: NextRequest, message: string, invalidToken: boolean): NextResponse {
  const params = [
    ...(invalidToken ? ['error="invalid_token"'] : []),
    ...(getOidcConfig() ? [`resource_metadata="${mcpResourceMetadataUrl(publicOrigin(req.headers))}"`] : []),
  ];
  return NextResponse.json(
    { error: message },
    { status: 401, headers: { "WWW-Authenticate": params.length ? `Bearer ${params.join(", ")}` : "Bearer" } }
  );
}

/**
 * The caller, from the bearer token: an integration token (household scopes,
 * and the member it acts as), else an Authelia access token (that member).
 * A bearer is required: without one, requireSession() would fall back to the
 * proxy headers, which this bypassed path can't trust.
 */
async function resolveCaller(req: NextRequest): Promise<McpCaller | NextResponse> {
  const raw = extractBearerToken(req.headers.get("authorization"));
  if (!raw) return unauthorized(req, "Missing Bearer token", false);

  const origin = publicOrigin(req.headers);
  const token = await resolveToken(raw);
  let caller: McpCaller;
  let rateKey: string;
  if (token) {
    caller = { householdId: token.householdId, memberId: token.memberId, scopes: token.scopes, origin };
    rateKey = token.tokenId;
  } else {
    try {
      const session = await requireSession();
      caller = { householdId: session.householdId, memberId: session.memberId, scopes: SIGNED_IN_SCOPES, origin };
      rateKey = `member:${session.memberId}`;
    } catch (err) {
      if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
      if (err instanceof AuthError) return unauthorized(req, "Invalid or expired token", true);
      throw err;
    }
  }

  const rl = await checkRateLimit(rateKey);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }
  return caller;
}

// MCP over Streamable HTTP, stateless: each POST builds a server for its
// caller and answers with JSON (no SSE stream, no session to resume).
export async function POST(req: NextRequest) {
  const caller = await resolveCaller(req);
  if (caller instanceof NextResponse) return caller;

  const server = buildDishesMcpServer(caller);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

// No server-to-client stream and no sessions to end (MCP spec: 405 is how a
// server says so).
function notAllowed() {
  return NextResponse.json({ error: "Method not allowed. POST MCP messages here." }, { status: 405, headers: { Allow: "POST" } });
}
export const GET = notAllowed;
export const DELETE = notAllowed;
