import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { householdMembers } from "@dishes/db/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { mentionsCholesterolDiet } from "@/lib/heart-healthy";

/**
 * The household's active members — who can be "cooked for" and rated by name
 * when logging a cook (cook_history.cooked_for / member_ratings key on display
 * names). The same query the web recipe page runs; nothing private beyond names and profile photos.
 * `cholesterolDiet` says whether to pre-select Heart-healthy when they're
 * eating (as the web's AI pages do) — the flag only, never their notes.
 */
export const GET = withApiErrors(async () => {
  const session = await requireSession();

  const members = await db
    .select({
      id: householdMembers.id,
      displayName: householdMembers.displayName,
      role: householdMembers.role,
      avatarUrl: householdMembers.avatarUrl,
      dietaryFlags: householdMembers.dietaryFlags,
      preferences: householdMembers.preferences,
      customNotes: householdMembers.customNotes,
    })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, session.householdId), eq(householdMembers.isActive, true)))
    .orderBy(asc(householdMembers.displayName));

  return NextResponse.json({
    members: members.map(({ dietaryFlags, preferences, customNotes, ...m }) => ({
      ...m,
      cholesterolDiet: mentionsCholesterolDiet([...(dietaryFlags ?? []), ...(preferences ?? []), customNotes]),
    })),
  });
});
