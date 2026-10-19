"use server";

import { db } from "@/lib/db";
import { cookAssistThreads, recipes } from "@dishes/db/schema";
import { resolveIdentity } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { and, asc, count, eq } from "drizzle-orm";

export async function saveCookAssistThread(
  recipeId: string,
  stepNumber: number,
  messages: Array<{ role: "user" | "assistant"; content: string }>
) {
  const user = await resolveIdentity();
  const { householdId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);
  if (!recipe) return { error: "Recipe not found." };

  const [row] = await db
    .insert(cookAssistThreads)
    .values({ householdId, recipeId, stepNumber, messages })
    .returning({ id: cookAssistThreads.id });
  return { id: row.id };
}

/** A thread that's still going (the iOS app saves after every answer). */
export async function updateCookAssistThread(
  threadId: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>
) {
  const user = await resolveIdentity();
  const { householdId } = await requireHousehold(user);

  await db
    .update(cookAssistThreads)
    .set({ messages })
    .where(
      and(
        eq(cookAssistThreads.id, threadId),
        eq(cookAssistThreads.householdId, householdId)
      )
    );
}

export async function getCookAssistThreads(recipeId: string) {
  const user = await resolveIdentity();
  const { householdId } = await requireHousehold(user);

  return db
    .select({
      id: cookAssistThreads.id,
      stepNumber: cookAssistThreads.stepNumber,
      messages: cookAssistThreads.messages,
    })
    .from(cookAssistThreads)
    .where(
      and(
        eq(cookAssistThreads.recipeId, recipeId),
        eq(cookAssistThreads.householdId, householdId)
      )
    )
    .orderBy(asc(cookAssistThreads.stepNumber), asc(cookAssistThreads.createdAt));
}

export async function countCookAssistThreads(recipeId: string) {
  const user = await resolveIdentity();
  const { householdId } = await requireHousehold(user);

  const [row] = await db
    .select({ n: count() })
    .from(cookAssistThreads)
    .where(
      and(
        eq(cookAssistThreads.recipeId, recipeId),
        eq(cookAssistThreads.householdId, householdId)
      )
    );
  return row?.n ?? 0;
}

export async function deleteCookAssistThread(threadId: string) {
  const user = await resolveIdentity();
  const { householdId } = await requireHousehold(user);

  await db
    .delete(cookAssistThreads)
    .where(
      and(
        eq(cookAssistThreads.id, threadId),
        eq(cookAssistThreads.householdId, householdId)
      )
    );
}

export async function deleteAllCookAssistThreadsForRecipe(recipeId: string) {
  const user = await resolveIdentity();
  const { householdId } = await requireHousehold(user);

  await db
    .delete(cookAssistThreads)
    .where(
      and(
        eq(cookAssistThreads.recipeId, recipeId),
        eq(cookAssistThreads.householdId, householdId)
      )
    );
}
