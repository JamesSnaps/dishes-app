"use server";

import { db } from "@/lib/db";
import { recipeAssistThreads, recipes } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { and, desc, eq } from "drizzle-orm";

export type RecipeAssistMessage = { role: "user" | "assistant"; content: string };

export type RecipeAssistThread = {
  id: string;
  title: string;
  messages: RecipeAssistMessage[];
  updatedAt: string; // ISO — safe to pass to client components
};

// Insert on first save, update in place afterwards, so continuing a
// conversation doesn't leave a trail of partial copies.
export async function saveRecipeAssistThread(
  recipeId: string,
  messages: RecipeAssistMessage[],
  threadId?: string | null
): Promise<{ id: string }> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  if (!messages.length) throw new Error("Nothing to save");

  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);
  if (!recipe) throw new Error("Recipe not found");

  const title =
    messages.find((m) => m.role === "user")?.content.slice(0, 200) ?? "Question";

  if (threadId) {
    const [existing] = await db
      .select({ id: recipeAssistThreads.id })
      .from(recipeAssistThreads)
      .where(
        and(
          eq(recipeAssistThreads.id, threadId),
          eq(recipeAssistThreads.householdId, householdId)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(recipeAssistThreads)
        .set({ messages, title, updatedAt: new Date() })
        .where(
          and(
            eq(recipeAssistThreads.id, threadId),
            eq(recipeAssistThreads.householdId, householdId)
          )
        );
      return { id: threadId };
    }
  }

  const [row] = await db
    .insert(recipeAssistThreads)
    .values({ householdId, recipeId, title, messages })
    .returning({ id: recipeAssistThreads.id });

  return row!;
}

export async function getRecipeAssistThreads(
  recipeId: string
): Promise<RecipeAssistThread[]> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const rows = await db
    .select({
      id: recipeAssistThreads.id,
      title: recipeAssistThreads.title,
      messages: recipeAssistThreads.messages,
      updatedAt: recipeAssistThreads.updatedAt,
    })
    .from(recipeAssistThreads)
    .where(
      and(
        eq(recipeAssistThreads.recipeId, recipeId),
        eq(recipeAssistThreads.householdId, householdId)
      )
    )
    .orderBy(desc(recipeAssistThreads.updatedAt));

  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function deleteRecipeAssistThread(threadId: string): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  await db
    .delete(recipeAssistThreads)
    .where(
      and(
        eq(recipeAssistThreads.id, threadId),
        eq(recipeAssistThreads.householdId, householdId)
      )
    );
}
