import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { householdMembers } from "@dishes/db/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";

/**
 * The household's active members — who can be "cooked for" and rated by name
 * when logging a cook (cook_history.cooked_for / member_ratings key on display
 * names). The same query the web recipe page runs; nothing private beyond names.
 */
export const GET = withApiErrors(async () => {
  const session = await requireSession();

  const members = await db
    .select({
      id: householdMembers.id,
      displayName: householdMembers.displayName,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, session.householdId), eq(householdMembers.isActive, true)))
    .orderBy(asc(householdMembers.displayName));

  return NextResponse.json({ members });
});
