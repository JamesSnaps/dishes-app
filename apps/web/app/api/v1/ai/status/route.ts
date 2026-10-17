import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { aiConfigurations } from "@dishes/db/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";

/** GET — whether the household has an AI key set up (Settings → AI on the web). */
export const GET = withApiErrors(async () => {
  const session = await requireSession();
  const [config] = await db
    .select({ id: aiConfigurations.id })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, session.householdId))
    .limit(1);
  return NextResponse.json({ configured: !!config });
});
