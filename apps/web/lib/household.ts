import { db, seedHousehold } from "@dishes/db";
import { households, householdMembers } from "@dishes/db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { AutheliaUser } from "@dishes/shared";

// In development, populate a newly-bootstrapped household with dummy content so
// the app is usable immediately without manual data entry. Guarded by an
// in-process flag so we only attempt it once per server start; seedHousehold is
// itself idempotent (no-ops if the household already has recipes).
let devSeedAttempted = false;
async function maybeSeedDev(householdId: string, memberId: string) {
  if (process.env.NODE_ENV !== "development" || devSeedAttempted) return;
  devSeedAttempted = true;
  try {
    const seeded = await seedHousehold(householdId, memberId);
    if (seeded) console.log("[dev] Seeded household with dummy content");
  } catch (err) {
    devSeedAttempted = false; // allow a retry on the next request
    console.error("[dev] Failed to seed household:", err);
  }
}

const memberColumns = {
  householdId: householdMembers.householdId,
  memberId: householdMembers.id,
  role: householdMembers.role,
};

export async function getOrCreateHousehold(user: AutheliaUser) {
  // Fast path: look up an existing membership for this Authelia user.
  const existing = await db
    .select(memberColumns)
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

  // First time — bootstrap a household for this user. Two concurrent
  // first-requests (e.g. the root layout and the page both calling
  // requireHousehold) can race here: both see no membership, both insert the
  // household, and the loser of the ON CONFLICT would find no member row yet.
  // Serialize the whole bootstrap with a transaction-scoped advisory lock keyed
  // on the username so the second request blocks, then re-reads and finds the
  // member the winner created. The lock auto-releases at transaction end.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.username}))`);

    // Re-check under the lock — the request that lost the race lands here and
    // finds the membership the winner just created.
    const [locked] = await tx
      .select(memberColumns)
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.autheliaUser, user.username),
          eq(householdMembers.isActive, true)
        )
      )
      .limit(1);
    if (locked) return locked;

    const slug = user.username.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const [household] = await tx
      .insert(households)
      .values({ name: `${user.displayName}'s Kitchen`, slug })
      .onConflictDoNothing()
      .returning({ id: households.id });

    // A household with this slug may already exist (e.g. created out-of-band)
    // even though this user has no membership — fall back to looking it up.
    const householdId =
      household?.id ??
      (
        await tx
          .select({ id: households.id })
          .from(households)
          .where(eq(households.slug, slug))
          .limit(1)
      )[0]!.id;

    const [member] = await tx
      .insert(householdMembers)
      .values({
        householdId,
        autheliaUser: user.username,
        displayName: user.displayName,
        role: "admin",
      })
      .returning(memberColumns);

    return member!;
  });
}

export async function requireHousehold(user: AutheliaUser) {
  const member = await getOrCreateHousehold(user);
  await maybeSeedDev(member.householdId, member.memberId);
  return member;
}
