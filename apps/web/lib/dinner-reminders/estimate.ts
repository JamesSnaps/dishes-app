import { db } from "@/lib/db";
import { cookHistory, recipes } from "@dishes/db/schema";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

/**
 * How long a recipe really takes this household, for "start cooking by"
 * maths. Recipe times are often optimistic, so real cook-mode durations win
 * whenever they exist.
 *
 * In order of trust:
 *  1. Two or more logged cooks → median of the last five.
 *  2. One logged cook → that cook averaged with the adjusted stated time.
 *  3. Stated prep + cook → scaled by how far off stated times usually are for
 *     this household (median actual ÷ stated across everything they've cooked).
 *  4. Nothing at all → a 45-minute guess.
 */

export type EstimateBasis = "history" | "single-cook" | "adjusted" | "stated" | "fallback";

export interface CookEstimate {
  minutes: number;
  basis: EstimateBasis;
  /** Logged cooks of this recipe that fed the estimate. */
  cookCount: number;
  /** Household slowness factor applied to stated times (1 = none). */
  ratio: number;
}

export interface EstimateInput {
  id: string;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
}

const FALLBACK_MINUTES = 45;
const MAX_RECENT = 5;
/** Below this many comparable cooks, the household ratio isn't trusted. */
const MIN_RATIO_SAMPLES = 3;
/** Cook-mode durations outside this window are a forgotten tab or a mis-tap. */
const MIN_PLAUSIBLE = 5;
const MAX_PLAUSIBLE = 600;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function plausible(minutes: number | null): minutes is number {
  return minutes !== null && minutes >= MIN_PLAUSIBLE && minutes <= MAX_PLAUSIBLE;
}

/** Round up to the next 5 minutes — a reminder shouldn't promise precision. */
function roundUp5(minutes: number): number {
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}

function statedMinutes(r: EstimateInput): number {
  return (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
}

/**
 * Median of actual ÷ stated across the household's logged cooks.
 *
 * Cooks whose duration equals the recipe's current cook time are skipped: the
 * cook debrief writes the measured duration back into `cook_time_minutes`, so
 * those rows would compare a cook against itself.
 */
export async function householdTimeRatio(householdId: string): Promise<number> {
  const rows = await db
    .select({
      actual: cookHistory.actualDuration,
      prep: recipes.prepTimeMinutes,
      cook: recipes.cookTimeMinutes,
    })
    .from(cookHistory)
    .innerJoin(recipes, eq(cookHistory.recipeId, recipes.id))
    .where(
      and(
        eq(cookHistory.householdId, householdId),
        eq(cookHistory.source, "cook"),
        isNotNull(cookHistory.actualDuration)
      )
    )
    .orderBy(desc(cookHistory.cookedAt))
    .limit(200);

  const ratios: number[] = [];
  for (const row of rows) {
    if (!plausible(row.actual)) continue;
    if (row.cook !== null && row.cook === row.actual) continue;
    const stated = (row.prep ?? 0) + (row.cook ?? 0);
    if (stated <= 0) continue;
    ratios.push(Math.min(3, Math.max(0.5, row.actual / stated)));
  }
  if (ratios.length < MIN_RATIO_SAMPLES) return 1;
  return Math.round(median(ratios) * 100) / 100;
}

/** Recent plausible cook durations per recipe, newest first. */
async function recentDurations(
  householdId: string,
  recipeIds: string[]
): Promise<Map<string, number[]>> {
  const byRecipe = new Map<string, number[]>();
  if (!recipeIds.length) return byRecipe;

  const rows = await db
    .select({ recipeId: cookHistory.recipeId, actual: cookHistory.actualDuration })
    .from(cookHistory)
    .where(
      and(
        eq(cookHistory.householdId, householdId),
        eq(cookHistory.source, "cook"),
        inArray(cookHistory.recipeId, recipeIds),
        isNotNull(cookHistory.actualDuration)
      )
    )
    .orderBy(desc(cookHistory.cookedAt));

  for (const row of rows) {
    if (!plausible(row.actual)) continue;
    const list = byRecipe.get(row.recipeId) ?? [];
    if (list.length < MAX_RECENT) list.push(row.actual);
    byRecipe.set(row.recipeId, list);
  }
  return byRecipe;
}

export function estimateFrom(
  recipe: EstimateInput,
  durations: number[],
  ratio: number
): CookEstimate {
  const stated = statedMinutes(recipe);
  const adjusted = stated * ratio;

  if (durations.length >= 2) {
    return { minutes: roundUp5(median(durations)), basis: "history", cookCount: durations.length, ratio };
  }
  if (durations.length === 1) {
    const single = durations[0]!;
    const minutes = stated > 0 ? (single + adjusted) / 2 : single;
    return { minutes: roundUp5(minutes), basis: "single-cook", cookCount: 1, ratio };
  }
  if (stated > 0) {
    // No household ratio yet: pad stated times a little, since they skew short.
    return ratio !== 1
      ? { minutes: roundUp5(adjusted), basis: "adjusted", cookCount: 0, ratio }
      : { minutes: roundUp5(stated * 1.1), basis: "stated", cookCount: 0, ratio };
  }
  return { minutes: FALLBACK_MINUTES, basis: "fallback", cookCount: 0, ratio };
}

/** Estimates for several recipes at once, all scoped to one household. */
export async function estimateCookTimes(
  householdId: string,
  recipeIds: string[]
): Promise<Map<string, CookEstimate>> {
  const ids = [...new Set(recipeIds)];
  const result = new Map<string, CookEstimate>();
  if (!ids.length) return result;

  const [recipeRows, durations, ratio] = await Promise.all([
    db
      .select({
        id: recipes.id,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
      })
      .from(recipes)
      .where(and(eq(recipes.householdId, householdId), inArray(recipes.id, ids))),
    recentDurations(householdId, ids),
    householdTimeRatio(householdId),
  ]);

  for (const r of recipeRows) {
    result.set(r.id, estimateFrom(r, durations.get(r.id) ?? [], ratio));
  }
  return result;
}

/** Reads after "It …", e.g. "usually takes you ~55 min (4 cooks)". */
export function describeEstimate(e: CookEstimate): string {
  switch (e.basis) {
    case "history":
      return `usually takes you ~${e.minutes} min (${e.cookCount} cooks)`;
    case "single-cook":
      return `should take ~${e.minutes} min (based on your one cook so far)`;
    case "adjusted":
      return `should take ~${e.minutes} min (recipe time × ${e.ratio} for your pace)`;
    case "stated":
      return `should take ~${e.minutes} min (recipe time plus a little slack)`;
    case "fallback":
      return `should take ~${e.minutes} min (no timing info, best guess)`;
  }
}
