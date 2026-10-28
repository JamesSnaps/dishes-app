import { NextRequest, NextResponse } from "next/server";
import { publicOrigin } from "@/lib/public-origin";
import { MCP_PATH, mcpResourceMetadata } from "@/lib/mcp/oauth-resource";

type RouteContext = { params: Promise<{ resource?: string[] }> };

// OAuth protected resource metadata (RFC 9728) for the MCP endpoint, at
// /.well-known/oauth-protected-resource/api/integrations/mcp and, for clients
// that only try the root, /.well-known/oauth-protected-resource. Public: it
// names the sign-in server and nothing private. 404 without OIDC set up.
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { resource = [] } = await params;
  const path = resource.length ? `/${resource.join("/")}` : MCP_PATH;
  const metadata = path === MCP_PATH ? mcpResourceMetadata(publicOrigin(req.headers)) : null;
  if (!metadata) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(metadata, { headers: { "Cache-Control": "public, max-age=3600" } });
}
