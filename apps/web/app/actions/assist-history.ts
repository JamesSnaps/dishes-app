"use server";

import { db } from "@/lib/db";
import { cookAssistThreads, recipeAssistThreads } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { and, count, eq, lt, min } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// Bulk management of saved AI conversations — the recipe-level "Ask about this
// recipe" threads and the per-step cooking-mode ones. Both are household-scoped.

export type AssistHistoryStats = {
  recipeThreads: number;
  cookThreads: number;
  oldest: string | null; // ISO date of the earliest thread of either kind
};

export type PurgeScope = "all" | "recipe" | "cook";

export async function getAssistHistoryStats(): Promise<AssistHistoryStats> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipeRow, cookRow] = await Promise.all([
    db
      .select({ n: count(), oldest: min(recipeAssistThreads.createdAt) })
      .from(recipeAssistThreads)
      .where(eq(recipeAssistThreads.householdId, householdId))
      .then((r) => r[0]),
    db
      .select({ n: count(), oldest: min(cookAssistThreads.createdAt) })
      .from(cookAssistThreads)
      .where(eq(cookAssistThreads.householdId, householdId))
      .then((r) => r[0]),
  ]);

  const dates = [recipeRow?.oldest, cookRow?.oldest]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    recipeThreads: Number(recipeRow?.n ?? 0),
    cookThreads: Number(cookRow?.n ?? 0),
    oldest: dates[0]?.toISOString() ?? null,
  };
}

// Delete saved conversations. `olderThanDays` of null clears everything in
// scope; otherwise only threads last touched before the cutoff are removed.
// Admin-only: this wipes history for the whole household, not just one person.
export async function purgeAssistHistory(
  scope: PurgeScope,
  olderThanDays: number | null
): Promise<{ recipeThreads: number; cookThreads: number }> {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);
  if (role !== "admin") throw new Error("Only household admins can clear AI history.");

  const cutoff =
    olderThanDays != null
      ? new Date(Date.now() - olderThanDays * 86400000)
      : null;

  let recipeDeleted = 0;
  let cookDeleted = 0;

  if (scope === "all" || scope === "recipe") {
    // Recipe threads are updated as a conversation continues, so age them by
    // last activity rather than when they were first asked.
    const rows = await db
      .delete(recipeAssistThreads)
      .where(
        cutoff
          ? and(
              eq(recipeAssistThreads.householdId, householdId),
              lt(recipeAssistThreads.updatedAt, cutoff)
            )
          : eq(recipeAssistThreads.householdId, householdId)
      )
      .returning({ id: recipeAssistThreads.id });
    recipeDeleted = rows.length;
  }

  if (scope === "all" || scope === "cook") {
    const rows = await db
      .delete(cookAssistThreads)
      .where(
        cutoff
          ? and(
              eq(cookAssistThreads.householdId, householdId),
              lt(cookAssistThreads.createdAt, cutoff)
            )
          : eq(cookAssistThreads.householdId, householdId)
      )
      .returning({ id: cookAssistThreads.id });
    cookDeleted = rows.length;
  }

  revalidatePath("/settings");
  return { recipeThreads: recipeDeleted, cookThreads: cookDeleted };
}

// Clear every saved "Ask about this recipe" conversation for one recipe.
export async function clearRecipeAssistThreads(recipeId: string): Promise<number> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const rows = await db
    .delete(recipeAssistThreads)
    .where(
      and(
        eq(recipeAssistThreads.recipeId, recipeId),
        eq(recipeAssistThreads.householdId, householdId)
      )
    )
    .returning({ id: recipeAssistThreads.id });

  return rows.length;
}
