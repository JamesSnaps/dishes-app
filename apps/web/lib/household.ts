import { db } from "@dishes/db";
import { households, householdMembers } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import type { AutheliaUser } from "@dishes/shared";

export async function getOrCreateHousehold(user: AutheliaUser) {
  // Look up an existing membership for this Authelia user
  const existing = await db
    .select({
      householdId: householdMembers.householdId,
      memberId: householdMembers.id,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.autheliaUser, user.username),
        eq(householdMembers.isActive, true)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0]!;
  }

  // First time — bootstrap a household for this user.
  // ON CONFLICT DO NOTHING guards against a race where two simultaneous
  // first-requests both see an empty membership and both try to insert.
  const slug = user.username.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const [household] = await db
    .insert(households)
    .values({ name: `${user.displayName}'s Kitchen`, slug })
    .onConflictDoNothing()
    .returning({ id: households.id });

  if (!household) {
    // Another request won the race — retry the membership lookup
    const [retry] = await db
      .select({
        householdId: householdMembers.householdId,
        memberId: householdMembers.id,
        role: householdMembers.role,
      })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.autheliaUser, user.username),
          eq(householdMembers.isActive, true)
        )
      )
      .limit(1);
    if (retry) return retry;
    throw new Error("Failed to bootstrap household — please try again");
  }

  const [member] = await db
    .insert(householdMembers)
    .values({
      householdId: household.id,
      autheliaUser: user.username,
      displayName: user.displayName,
      role: "admin",
    })
    .returning({
      householdId: householdMembers.householdId,
      memberId: householdMembers.id,
      role: householdMembers.role,
    });

  return member!;
}

export async function requireHousehold(user: AutheliaUser) {
  return getOrCreateHousehold(user);
}
