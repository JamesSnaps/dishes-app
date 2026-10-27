import { listOutsideMeals } from "@/lib/services/outside-meals";

/**
 * Meals the household isn't cooking from the plan — eaten out, takeaways, at
 * friends', skipped — as the integrations API shows them: what and where,
 * and the calories once estimated. Dates inclusive, YYYY-MM-DD.
 */
export async function outsideMealsJson(householdId: string, from: string, to: string) {
  const meals = await listOutsideMeals(householdId, { from, to });
  return meals.map((m) => ({
    id: m.id,
    date: m.date,
    dayOfWeek: (new Date(`${m.date}T00:00:00Z`).getUTCDay() + 6) % 7,
    mealType: m.mealType,
    kind: m.kind,
    title: m.title,
    place: m.place,
    cuisine: m.cuisine,
    calories: m.calories,
    /** "ai" = estimated, "manual" = typed in, "none" = not yet. */
    nutritionSource: m.nutritionSource,
  }));
}
