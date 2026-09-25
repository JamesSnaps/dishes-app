/**
 * Every meal a household has eaten, all-time — shared by Stats and Wrapped.
 *
 * "What we ate" is reconstructed from two records, because neither is complete
 * on its own:
 *   - meal plan entries up to today — the richest record, but a plan is only
 *     an intention;
 *   - logged cooks (cook_history, source 'cook') — confirmed, and the only
 *     place that says who was eating (`cooked_for`), but most meals never get
 *     logged.
 * A planned meal and a logged cook of the same recipe on the same day are one
 * meal. A meal counts for everyone unless a logged cook names who ate it.
 */

import { db } from "@/lib/db";
import {
  cookHistory,
  householdMembers,
  mealPlanEntries,
  mealPlans,
  recipeIngredients,
  recipes,
} from "@dishes/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export type Meal = {
  date: string; // YYYY-MM-DD
  recipeId: string;
  /** Planned slot, when the meal came from the meal plan. */
  mealType: string | null;
  /** Display names from a logged cook, or null — everyone. */
  who: string[] | null;
};

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Whether `displayName` ate meal `m` (everyone did, unless a cook names who). */
export function ateIt(m: Meal, displayName: string): boolean {
  const name = displayName.trim().toLowerCase();
  return m.who === null || m.who.some((w) => w.trim().toLowerCase() === name);
}

export async function loadMealHistory(householdId: string) {
  const today = isoDate(new Date());

  const [plannedRows, cookRows, recipeRows, memberRows] = await Promise.all([
    db
      .select({
        weekStartDate: mealPlans.weekStartDate,
        dayOfWeek: mealPlanEntries.dayOfWeek,
        recipeId: mealPlanEntries.recipeId,
        mealType: mealPlanEntries.mealType,
      })
      .from(mealPlanEntries)
      .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
      .where(eq(mealPlans.householdId, householdId)),
    db
      .select({
        id: cookHistory.id,
        recipeId: cookHistory.recipeId,
        cookedAt: cookHistory.cookedAt,
        cookedFor: cookHistory.cookedFor,
        rating: cookHistory.rating,
        actualDuration: cookHistory.actualDuration,
        photoUrl: cookHistory.photoUrl,
        notes: cookHistory.notes,
        occasion: cookHistory.occasion,
        memberRatings: cookHistory.memberRatings,
        source: cookHistory.source,
      })
      .from(cookHistory)
      .where(eq(cookHistory.householdId, householdId)),
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        cuisine: recipes.cuisine,
        calories: recipes.calories,
        saturatedFatG: recipes.saturatedFatG,
        fiberG: recipes.fiberG,
        isFavourite: recipes.isFavourite,
        isAiGenerated: recipes.isAiGenerated,
        imageUrl: recipes.imageUrl,
        thumbnailUrl: recipes.thumbnailUrl,
        createdById: recipes.createdById,
        createdAt: recipes.createdAt,
      })
      .from(recipes)
      .where(eq(recipes.householdId, householdId)),
    db
      .select({
        id: householdMembers.id,
        displayName: householdMembers.displayName,
        dietaryFlags: householdMembers.dietaryFlags,
        customNotes: householdMembers.customNotes,
      })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.isActive, true)))
      .orderBy(householdMembers.displayName),
  ]);

  const recipeById = new Map(recipeRows.map((r) => [r.id, r]));

  const ingredientRows = recipeRows.length
    ? await db
        .select({ recipeId: recipeIngredients.recipeId, ingredientName: recipeIngredients.ingredientName })
        .from(recipeIngredients)
        .where(inArray(recipeIngredients.recipeId, recipeRows.map((r) => r.id)))
    : [];
  const ingredientsByRecipe = new Map<string, string[]>();
  for (const row of ingredientRows) {
    const list = ingredientsByRecipe.get(row.recipeId);
    if (list) list.push(row.ingredientName);
    else ingredientsByRecipe.set(row.recipeId, [row.ingredientName]);
  }

  const cooks = cookRows
    .filter((c) => c.source === "cook")
    .map((c) => ({ ...c, date: isoDate(c.cookedAt) }));

  const cookByKey = new Map<string, (typeof cooks)[number]>();
  for (const c of cooks) cookByKey.set(`${c.recipeId}|${c.date}`, c);

  const allMeals: Meal[] = [];
  const seen = new Set<string>();

  for (const p of plannedRows) {
    const date = addDays(p.weekStartDate, p.dayOfWeek);
    if (date > today) continue; // still in the future — not eaten yet
    const key = `${p.recipeId}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cook = cookByKey.get(key);
    allMeals.push({
      date,
      recipeId: p.recipeId,
      mealType: p.mealType,
      who: cook?.cookedFor?.length ? cook.cookedFor : null,
    });
  }
  for (const c of cooks) {
    const key = `${c.recipeId}|${c.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allMeals.push({ date: c.date, recipeId: c.recipeId, mealType: null, who: c.cookedFor?.length ? c.cookedFor : null });
  }
  allMeals.sort((a, b) => a.date.localeCompare(b.date));

  return { today, allMeals, cooks, cookRows, recipeRows, recipeById, ingredientsByRecipe, memberRows };
}

export type MealHistory = Awaited<ReturnType<typeof loadMealHistory>>;
