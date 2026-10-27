import { and, avg, eq, inArray } from "drizzle-orm";
import { cookHistory, mealPlanEntries, mealPlans, recipeIngredients, recipes } from "@dishes/db/schema";
import { db } from "@/lib/db";
import {
  PROTEIN_KINDS,
  PROTEIN_LABELS,
  WEEKLY_PROTEIN_TARGETS,
  meetsTarget,
  summariseMeals,
  type MealSummary,
  type ProteinKind,
} from "@/lib/meal-stats";
import { suggestSwaps, type SwapSuggestion } from "@/lib/meal-swaps";
import { householdHasCholesterolDiet } from "@/lib/services/heart-focus";
import { listOutsideMeals, weekRange } from "@/lib/services/outside-meals";
import { countsAsMeal, outsideMealFacts } from "@/lib/outside-meals";

export interface WeekNutrition {
  summary: MealSummary;
  /** Someone is on a cholesterol-lowering diet: show the weekly protein targets. */
  heartFocus: boolean;
  /** Each weekly protein target, with this week's count (heart focus only). */
  targets: { kind: ProteinKind; label: string; count: number; ok: boolean; target: string }[];
  suggestions: SwapSuggestion[];
}

function targetText(kind: ProteinKind): string {
  const t = WEEKLY_PROTEIN_TARGETS[kind]!;
  if (t.min !== undefined) return `aim ${t.min}+`;
  return t.max === 0 ? "aim none" : `max ${t.max}`;
}

/**
 * The meal planner's nutrition strip for one week, server-side for the native
 * app: the same `summariseMeals` and `suggestSwaps` the web planner runs in
 * the browser over the same rows (week-planner.tsx, meal-plan/page.tsx).
 */
export async function getWeekNutrition(householdId: string, weekStartDate: string): Promise<WeekNutrition> {
  const [plan] = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.householdId, householdId), eq(mealPlans.weekStartDate, weekStartDate)))
    .limit(1);

  const [allEntries, library, heartFocus, outside] = await Promise.all([
    plan
      ? db
          .select({
            id: mealPlanEntries.id,
            dayOfWeek: mealPlanEntries.dayOfWeek,
            mealType: mealPlanEntries.mealType,
            recipeId: mealPlanEntries.recipeId,
          })
          .from(mealPlanEntries)
          .where(eq(mealPlanEntries.mealPlanId, plan.id))
      : Promise.resolve([]),
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        cuisine: recipes.cuisine,
        isFavourite: recipes.isFavourite,
        calories: recipes.calories,
        saturatedFatG: recipes.saturatedFatG,
        fiberG: recipes.fiberG,
        mealRole: recipes.mealRole,
        mealTypes: recipes.mealTypes,
      })
      .from(recipes)
      .where(eq(recipes.householdId, householdId)),
    householdHasCholesterolDiet(householdId),
    listOutsideMeals(householdId, weekRange(weekStartDate)),
  ]);

  // A slot taken by a meal not cooked at home (eating out, a takeaway…)
  // drops whatever recipe is still planned there; what was eaten counts
  // instead — the same rule as the web planner (week-planner.tsx).
  const dayOf = (date: string) =>
    Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${weekStartDate}T00:00:00Z`)) / 86_400_000);
  const taken = new Set(outside.map((m) => `${dayOf(m.date)}|${m.mealType}`));
  const entries = allEntries.filter((e) => !taken.has(`${e.dayOfWeek}|${e.mealType}`));

  const ids = library.map((r) => r.id);
  const [ingredientRows, ratingRows] = ids.length
    ? await Promise.all([
        db
          .select({ recipeId: recipeIngredients.recipeId, name: recipeIngredients.ingredientName })
          .from(recipeIngredients)
          .where(inArray(recipeIngredients.recipeId, ids)),
        db
          .select({ recipeId: cookHistory.recipeId, avgRating: avg(cookHistory.rating) })
          .from(cookHistory)
          .where(and(eq(cookHistory.householdId, householdId), inArray(cookHistory.recipeId, ids)))
          .groupBy(cookHistory.recipeId),
      ])
    : [[], []];

  const names = new Map<string, string[]>();
  for (const row of ingredientRows) names.set(row.recipeId, [...(names.get(row.recipeId) ?? []), row.name]);
  // Stored 0–10 (half stars); the swap rules work in 0–5.
  const rating = new Map(ratingRows.map((r) => [r.recipeId, r.avgRating === null ? null : Number(r.avgRating) / 2]));

  const swapLibrary = library.map((r) => ({
    ...r,
    avgRating: rating.get(r.id) ?? null,
    ingredientNames: names.get(r.id) ?? [],
    mealTypes: r.mealTypes ?? [],
  }));
  const byId = new Map(swapLibrary.map((r) => [r.id, r]));

  const summary = summariseMeals([
    ...entries.map((e) => {
      const r = byId.get(e.recipeId);
      return {
        recipeId: e.recipeId,
        calories: r?.calories ?? null,
        saturatedFatG: r?.saturatedFatG ?? null,
        fiberG: r?.fiberG ?? null,
        ingredientNames: r?.ingredientNames ?? [],
      };
    }),
    ...outside.filter(countsAsMeal).map(outsideMealFacts),
  ]);

  const targetKinds = PROTEIN_KINDS.filter((k) => WEEKLY_PROTEIN_TARGETS[k]);
  return {
    summary,
    heartFocus,
    targets: heartFocus
      ? targetKinds.map((kind) => ({
          kind,
          label: PROTEIN_LABELS[kind],
          count: summary.proteins[kind],
          ok: meetsTarget(kind, summary.proteins[kind]) !== false,
          target: targetText(kind),
        }))
      : [],
    suggestions: heartFocus
      ? suggestSwaps(
          entries.map((e) => ({ id: e.id, dayOfWeek: e.dayOfWeek, mealType: e.mealType, recipeId: e.recipeId })),
          swapLibrary,
          summary.proteins
        )
      : [],
  };
}
