/**
 * Gathers the diner brief (`lib/diner-brief.ts`) for one household. Not a
 * "use server" module: it takes a householdId, so only server code that has
 * already resolved the caller's household (an integration token, a session)
 * may call it.
 */

import { getAiContext } from "@/lib/services/ai-context";
import { getWeekNutrition } from "@/lib/services/week-nutrition";
import { addDays, loadMealHistory } from "@/lib/services/meal-history";
import { weekStartOf } from "@/lib/dinner-reminders/time";
import { CHOLESTEROL_DIETARY_FLAG, mentionsCholesterolDiet } from "@/lib/heart-healthy";
import { PROTEIN_KINDS, PROTEIN_LABELS } from "@/lib/meal-stats";
import { isOutsideMealDescribed } from "@/lib/outside-meals";
import {
  matchDiners,
  proteinStatus,
  proteinTargetText,
  type DinerBrief,
  type DinerBriefMeal,
} from "@/lib/diner-brief";

export class UnknownDinerError extends Error {
  constructor(
    readonly unknown: string[],
    readonly known: string[]
  ) {
    super(`No household member called ${unknown.join(", ")}. Members: ${known.join(", ")}`);
    this.name = "UnknownDinerError";
  }
}

/** Ratings are stored 0–10 (half stars); the brief speaks 1–5. */
function toStars(rating: number | string | null | undefined): number | null {
  if (rating == null || rating === "") return null;
  const n = Number(rating);
  return Number.isFinite(n) ? n / 2 : null;
}

/**
 * The brief for a meal on `date` (YYYY-MM-DD). `diners` are display names or
 * member ids; empty means the whole household. Throws `UnknownDinerError` for
 * a name that matches nobody.
 */
export async function getDinerBrief(
  householdId: string,
  { date, diners: wanted = [] }: { date: string; diners?: string[] }
): Promise<DinerBrief> {
  const weekStartDate = weekStartOf(date);
  const [ai, week, history] = await Promise.all([
    getAiContext({ householdId }),
    getWeekNutrition(householdId, weekStartDate),
    loadMealHistory(householdId),
  ]);

  const { diners, unknown } = matchDiners(ai.members, wanted);
  if (unknown.length) throw new UnknownDinerError(unknown, ai.members.map((m) => m.displayName));

  const heartFocus = diners.some(
    (d) => d.dietaryFlags.includes(CHOLESTEROL_DIETARY_FLAG) || mentionsCholesterolDiet([d.customNotes])
  );
  const year = Number(date.slice(0, 4));
  const names = diners.map((d) => d.displayName.trim().toLowerCase());
  const anyDinerIn = (who: string[] | null | undefined) =>
    !who?.length || who.some((w) => names.includes(w.trim().toLowerCase()));

  // The week before the meal, for the diners named.
  const from = addDays(date, -7);
  const inWindow = (d: string) => d >= from && d < date;
  const cookRating = new Map(
    history.cooks.map((c) => [`${c.recipeId}|${c.date}`, toStars(c.rating)] as const)
  );
  const recentMeals: DinerBriefMeal[] = [
    ...history.allMeals
      .filter((m) => inWindow(m.date) && anyDinerIn(m.who))
      .flatMap((m) => {
        const recipe = history.recipeById.get(m.recipeId);
        if (!recipe) return [];
        return [
          {
            date: m.date,
            title: recipe.title,
            cuisine: recipe.cuisine,
            outside: false,
            place: null,
            rating: cookRating.get(`${m.recipeId}|${m.date}`) ?? null,
          },
        ];
      }),
    ...history.outsideMeals
      .filter((m) => inWindow(m.date) && anyDinerIn(m.eatenBy) && isOutsideMealDescribed(m))
      .map((m) => ({
        date: m.date,
        title: m.title || m.description || m.courses.map((c) => c.name ?? c.text).join(", ") || "A meal out",
        cuisine: m.cuisine,
        outside: true,
        place: m.place,
        rating: toStars(m.rating),
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return {
    date,
    diners: diners.map((d) => ({
      id: d.id,
      name: d.displayName,
      age: d.birthYear ? year - d.birthYear : null,
      child: d.role === "child",
      dietaryRequirements: d.dietaryFlags,
      dislikes: d.dislikes,
      loves: d.preferences,
      notes: d.customNotes?.trim() || null,
    })),
    heartFocus,
    taste: ai.tasteProfile,
    week: {
      weekStartDate,
      meals: week.summary.meals,
      avgCalories: week.summary.avgCalories,
      avgSaturatedFatG: week.summary.avgSaturatedFatG,
      avgFiberG: week.summary.avgFiberG,
      proteins: PROTEIN_KINDS.map((kind) => {
        const count = week.summary.proteins[kind];
        return {
          kind,
          label: PROTEIN_LABELS[kind],
          count,
          target: heartFocus ? proteinTargetText(kind) : null,
          status: heartFocus ? proteinStatus(kind, count) : null,
        };
      }),
    },
    recentMeals,
  };
}
