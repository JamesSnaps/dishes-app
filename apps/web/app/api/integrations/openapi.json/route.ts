import { NextRequest, NextResponse } from "next/server";
import { buildIntegrationsOpenApi } from "@/lib/integrations-openapi";
import { OPERATION_SETS } from "@/lib/integrations-catalog";
import { publicOrigin } from "@/lib/public-origin";

// Public on purpose: AI assistants and n8n import the spec before they have a
// token configured. It describes the API shape only — no household data.
// ?ops=<set> serves a trimmed spec for one job (OPERATION_SETS), e.g.
// ?ops=meals-out for a ChatGPT custom GPT that helps choose from a menu.
export function GET(req: NextRequest) {
  const ops = req.nextUrl.searchParams.get("ops");
  if (ops !== null && !Object.hasOwn(OPERATION_SETS, ops)) {
    return NextResponse.json(
      { error: `Unknown ops "${ops}". One of: ${Object.keys(OPERATION_SETS).join(", ")}` },
      { status: 400 }
    );
  }
  return NextResponse.json(buildIntegrationsOpenApi(publicOrigin(req.headers), ops ?? undefined));
}
