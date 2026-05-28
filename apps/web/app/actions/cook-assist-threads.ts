"use server";

import { db } from "@/lib/db";
import { cookAssistThreads } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { and, asc, count, eq } from "drizzle-orm";

export async function saveCookAssistThread(
  recipeId: string,
  stepNumber: number,
  messages: Array<{ role: "user" | "assistant"; content: string }>
) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  await db.insert(cookAssistThreads).values({
    householdId,
    recipeId,
    stepNumber,
    messages,
  });
}

export async function getCookAssistThreads(recipeId: string) {
  const user = await getAutheliaUser();
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
  const user = await getAutheliaUser();
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
  const user = await getAutheliaUser();
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
  const user = await getAutheliaUser();
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
