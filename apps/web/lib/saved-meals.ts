import { MEAL_ROLE_LABELS, type MealRole } from "@dishes/shared";
import type { SavedMeal, SavedMealSlot } from "@/lib/services/meals";

/**
 * Pure helpers for saved meals, safe on client and server alike (the service
 * module imports the database, so components can't pull these from there).
 */

/** What a slot is called: its own label, or its role ("Main", "Side"). */
export function slotName(slot: Pick<SavedMealSlot, "label" | "role">): string {
  return slot.label?.trim() || MEAL_ROLE_LABELS[slot.role];
}

/**
 * Whether adding this meal needs the person to choose anything. A meal whose
 * every slot has a single option goes straight on the plan.
 */
export function needsChoices(meal: SavedMeal): boolean {
  return meal.slots.some((s) => s.options.length > 1);
}

/** Option ids pre-selected per slot: last time's choice, else the first option. */
export function defaultSelection(meal: SavedMeal): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const slot of meal.slots) {
    const defaults = slot.options.filter((o) => o.isDefault).map((o) => o.recipe.id);
    out[slot.id] = slot.allowMultiple
      ? defaults
      : [defaults[0] ?? slot.options[0]?.recipe.id].filter((id): id is string => !!id);
  }
  return out;
}

/** A selection as the dishes to put on the plan, in slot order. */
export function selectionToComponents(
  meal: SavedMeal,
  selection: Record<string, string[]>
): { recipeId: string; role: MealRole }[] {
  return meal.slots.flatMap((slot) =>
    (selection[slot.id] ?? []).map((recipeId) => ({ recipeId, role: slot.role }))
  );
}

/** "a side", "an extra" — for labels built from a role name. */
export function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

/**
 * Saved meals as the UI receives them, upgraded if they predate slots. A page
 * cached by the service worker before v1.16 carries `components` (one recipe
 * per dish) instead of `slots`; rendering that with current code would crash
 * the planner, so each old component becomes a single-option slot.
 */
export function normaliseSavedMeals(meals: SavedMeal[]): SavedMeal[] {
  return meals.map((meal) => {
    if (Array.isArray(meal.slots)) return meal;
    const legacy = (meal as unknown as { components?: LegacyComponent[] }).components ?? [];
    return {
      ...meal,
      slots: legacy.map((c, i) => ({
        id: c.id,
        role: c.role,
        label: null,
        position: i,
        allowMultiple: false,
        options: [{ id: c.id, position: 0, isDefault: true, recipe: c.recipe }],
      })),
    };
  });
}

type LegacyComponent = {
  id: string;
  role: SavedMealSlot["role"];
  recipe: SavedMealSlot["options"][number]["recipe"];
};
