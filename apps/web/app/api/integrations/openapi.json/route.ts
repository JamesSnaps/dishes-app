import { NextRequest, NextResponse } from "next/server";
import { buildIntegrationsOpenApi } from "@/lib/integrations-openapi";
import { publicOrigin } from "@/lib/public-origin";

// Public on purpose: AI assistants and n8n import the spec before they have a
// token configured. It describes the API shape only — no household data.
export function GET(req: NextRequest) {
  return NextResponse.json(buildIntegrationsOpenApi(publicOrigin(req.headers)));
}
