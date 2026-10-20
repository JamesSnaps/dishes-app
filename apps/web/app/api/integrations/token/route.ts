import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { households, integrationTokens } from "@dishes/db/schema";
import { eq } from "drizzle-orm";

// The calling token itself: its name, scopes and household. Any valid token may
// ask, so a client (the Home Assistant integration) can offer just what the
// token allows instead of probing each endpoint for a 403.
export const GET = withIntegrationAuth(null, async (_req: NextRequest, ctx) => {
  const [row] = await db
    .select({ name: integrationTokens.name, householdName: households.name })
    .from(integrationTokens)
    .innerJoin(households, eq(integrationTokens.householdId, households.id))
    .where(eq(integrationTokens.id, ctx.tokenId))
    .limit(1);

  return NextResponse.json({
    name: row?.name ?? null,
    household: row?.householdName ?? null,
    scopes: ctx.scopes,
  });
});
