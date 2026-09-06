/**
 * Shared definitions of the recipe-library "suggestion styles" used by the AI
 * meal planner.
 *
 * The planner (`app/actions/ai.ts`) filters by these, and the concierge page
 * counts and previews them. Both go through here so the number on the button
 * can never disagree with the library the planner actually draws from.
 */

import { db } from "@/lib/db";
import { recipes, mealPlanEntries, mealPlans, cookHistory } from "@dishes/db/schema";
import { eq, and, count, inArray, sql } from "drizzle-orm";

/**
 * How many times a recipe must have been used to count as one of "our
 * regulars". Uses = the larger of times planned and actual cooks logged; a dish
 * cooked every week without ever being planned still counts.
 */
export const FREQUENT_MIN_USES = 3;

export type LibraryStyle = "favourites" | "regulars" | "new";

export type StyleBreakdown = {
  /** Every recipe in the household, whatever its history. */
  total: number;
  counts: Record<LibraryStyle, number>;
  /** Titles behind each count, for the preview. Capped — see PREVIEW_LIMIT. */
  samples: Record<LibraryStyle, string[]>;
  /** True when a style has more recipes than the preview lists. */
  truncated: Record<LibraryStyle, boolean>;
};

/** The preview is a reassurance, not a second recipe list. */
const PREVIEW_LIMIT = 40;

/**
 * Count and sample the recipes behind each suggestion style.
 *
 * Note this deliberately ignores the recency cooldown and the stacking filters
 * (cuisine, tag, calories): it answers "how big is this pool", not "what will
 * this exact generation pick from". The debug log answers the latter.
 */
export async function getStyleBreakdown(householdId: string): Promise<StyleBreakdown> {
  const rows = await db
    .select({
      id: recipes.id,
      title: recipes.title,
      isFavourite: recipes.isFavourite,
    })
    .from(recipes)
    .where(eq(recipes.householdId, householdId))
    .orderBy(recipes.title);

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) {
    const empty = { favourites: 0, regulars: 0, new: 0 };
    const emptyList = { favourites: [], regulars: [], new: [] };
    const emptyFlag = { favourites: false, regulars: false, new: false };
    return { total: 0, counts: empty, samples: emptyList, truncated: emptyFlag };
  }

  // Aggregated separately rather than joined onto recipes: joining plan entries
  // and cook history in one grouped query fans out and multiplies the counts.
  const [planRows, cookRows] = await Promise.all([
    db
      .select({ recipeId: mealPlanEntries.recipeId, times: count(mealPlanEntries.id) })
      .from(mealPlanEntries)
      .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
      .where(and(eq(mealPlans.householdId, householdId), inArray(mealPlanEntries.recipeId, ids)))
      .groupBy(mealPlanEntries.recipeId),
    db
      .select({
        recipeId: cookHistory.recipeId,
        // Rating-only rows aren't cooks, so they don't count here.
        times: count(sql`case when ${cookHistory.source} = 'cook' then 1 end`),
      })
      .from(cookHistory)
      .where(inArray(cookHistory.recipeId, ids))
      .groupBy(cookHistory.recipeId),
  ]);

  const planned = new Map(planRows.map((r) => [r.recipeId, Number(r.times)]));
  const cooked = new Map(cookRows.map((r) => [r.recipeId, Number(r.times)]));

  const buckets: Record<LibraryStyle, string[]> = { favourites: [], regulars: [], new: [] };

  for (const r of rows) {
    const timesUsed = Math.max(planned.get(r.id) ?? 0, cooked.get(r.id) ?? 0);
    if (r.isFavourite) buckets.favourites.push(r.title);
    if (timesUsed >= FREQUENT_MIN_USES) buckets.regulars.push(r.title);
    if (timesUsed === 0) buckets.new.push(r.title);
  }

  const styles: LibraryStyle[] = ["favourites", "regulars", "new"];
  const counts = {} as Record<LibraryStyle, number>;
  const samples = {} as Record<LibraryStyle, string[]>;
  const truncated = {} as Record<LibraryStyle, boolean>;
  for (const style of styles) {
    counts[style] = buckets[style].length;
    samples[style] = buckets[style].slice(0, PREVIEW_LIMIT);
    truncated[style] = buckets[style].length > PREVIEW_LIMIT;
  }

  return { total: rows.length, counts, samples, truncated };
}
