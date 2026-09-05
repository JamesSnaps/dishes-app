"use server";

import { db } from "@/lib/db";
import { householdMembers } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";

/**
 * Mark the welcome wizard as done for the current member. Called both when
 * they finish it and when they skip — a member who dismissed the tour should
 * not be greeted again on the next page load.
 */
export async function completeOnboarding(): Promise<void> {
  const session = await requireSession();

  await db
    .update(householdMembers)
    .set({ onboardingCompletedAt: new Date() })
    .where(eq(householdMembers.id, session.memberId));

  revalidatePath("/", "layout");
}

/** Re-run the tour from Settings. */
export async function resetOnboarding(): Promise<void> {
  const session = await requireSession();

  await db
    .update(householdMembers)
    .set({ onboardingCompletedAt: null })
    .where(eq(householdMembers.id, session.memberId));

  revalidatePath("/", "layout");
}
