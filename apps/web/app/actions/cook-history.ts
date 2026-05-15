"use server";

import { db } from "@/lib/db";
import { cookHistory, recipes } from "@dishes/db/schema";
import { eq, and, avg, count, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export type LogCookInput = {
  rating?: number | null;
  actualDuration?: number | null;
  notes?: string | null;
  occasion?: string | null;
  cookedFor?: string[] | null;
};

export async function logCook(
  recipeId: string,
  data: LogCookInput
): Promise<{ id: string }> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [row] = await db
    .insert(cookHistory)
    .values({
      householdId,
      recipeId,
      rating: data.rating != null ? String(data.rating) : null,
      actualDuration: data.actualDuration ?? null,
      notes: data.notes?.trim() || null,
      occasion: data.occasion?.trim() || null,
      cookedFor: data.cookedFor?.length ? data.cookedFor : null,
    })
    .returning({ id: cookHistory.id });

  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
  return row!;
}

export async function rateCook(
  cookId: string,
  rating: number
): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [row] = await db
    .select({ recipeId: cookHistory.recipeId })
    .from(cookHistory)
    .where(
      and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, householdId))
    )
    .limit(1);

  if (!row) throw new Error("Cook history record not found");

  await db
    .update(cookHistory)
    .set({ rating: String(rating) })
    .where(eq(cookHistory.id, cookId));

  revalidatePath(`/recipes/${row.recipeId}`);
  revalidatePath("/recipes");
}

export async function rateRecipe(
  recipeId: string,
  rating: number,
  notes?: string
): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) throw new Error("Recipe not found");

  await db.insert(cookHistory).values({
    householdId,
    recipeId,
    rating: String(rating),
    notes: notes?.trim() || null,
  });

  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
}

export type CookStats = {
  cookCount: number;
  averageRating: number | null;
};

export async function getCookStats(
  recipeId: string,
  householdId: string
): Promise<CookStats> {
  const [row] = await db
    .select({
      cookCount: count(cookHistory.id),
      averageRating: avg(cookHistory.rating),
    })
    .from(cookHistory)
    .where(
      and(
        eq(cookHistory.recipeId, recipeId),
        eq(cookHistory.householdId, householdId)
      )
    );

  const rawAvg = row?.averageRating;
  return {
    cookCount: Number(row?.cookCount ?? 0),
    averageRating:
      rawAvg != null
        ? Math.round(parseFloat(rawAvg) * 10) / 10
        : null,
  };
}

export type CookHistoryEntry = {
  id: string;
  cookedAt: string; // ISO string — safe to pass to client components
  rating: number | null;
  actualDuration: number | null;
  notes: string | null;
  occasion: string | null;
  cookedFor: string[] | null;
};

export async function getRecipeCookHistory(
  recipeId: string,
  householdId: string
): Promise<CookHistoryEntry[]> {
  const rows = await db
    .select({
      id: cookHistory.id,
      cookedAt: cookHistory.cookedAt,
      rating: cookHistory.rating,
      actualDuration: cookHistory.actualDuration,
      notes: cookHistory.notes,
      occasion: cookHistory.occasion,
      cookedFor: cookHistory.cookedFor,
    })
    .from(cookHistory)
    .where(
      and(
        eq(cookHistory.recipeId, recipeId),
        eq(cookHistory.householdId, householdId)
      )
    )
    .orderBy(desc(cookHistory.cookedAt));

  return rows.map((r) => ({
    ...r,
    cookedAt: r.cookedAt.toISOString(),
    rating: r.rating != null ? parseFloat(r.rating) : null,
  }));
}
