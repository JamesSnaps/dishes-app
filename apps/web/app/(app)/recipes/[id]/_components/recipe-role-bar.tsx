/**
 * Shows what part a recipe plays in a meal and lets you change it in one tap,
 * or ask the AI to draft a side that goes with it.
 *
 * Example: open a cottage pie and tap Side to mark it, or tap Generate a side
 * dish to draft peas as a new recipe with the Side role already set.
 */
"use client";

import { useState, useTransition } from "react";
import { MEAL_ROLES, MEAL_ROLE_LABELS, type MealRole } from "@dishes/shared";
import { setRecipeMealRole } from "@/app/actions/recipes";
import { GenerateSideSheet } from "@/components/meals/generate-side-sheet";

export function RecipeRoleBar({
  recipeId,
  mealRole,
  recipeTitle,
}: {
  recipeId: string;
  mealRole: MealRole | null;
  recipeTitle: string;
}) {
  const [role, setRole] = useState<MealRole | null>(mealRole);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: MealRole) {
    const value = role === next ? null : next;
    setRole(value);
    setError(null);
    startTransition(async () => {
      try {
        await setRecipeMealRole(recipeId, value);
      } catch {
        setRole(mealRole);
        setError("Couldn't update the role. Please try again.");
      }
    });
  }

  return (
    <div className="mb-4 rounded-xl border border-orange-200/80 bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 p-3 shadow-sm dark:border-orange-900/50 dark:from-orange-950/40 dark:via-amber-950/20 dark:to-rose-950/30">
      <p className="mb-2 text-sm font-semibold">What kind of dish is this?</p>
      <div className="flex flex-wrap gap-2">
        {MEAL_ROLES.map((option) => {
          const active = role === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              disabled={pending}
              onClick={() => choose(option)}
              className={
                active
                  ? "rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-3 py-1 text-sm font-semibold text-white shadow-sm"
                  : "rounded-full border border-orange-300/80 bg-white/80 px-3 py-1 text-sm font-medium text-orange-900 shadow-sm hover:bg-white dark:border-orange-800 dark:bg-black/20 dark:text-orange-200 dark:hover:bg-black/30"
              }
            >
              {MEAL_ROLE_LABELS[option]}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {role
          ? `${MEAL_ROLE_LABELS[role]}. Tap it again to clear. Sides, sauces and extras stay out of the planner's standalone slots.`
          : "Not marked yet, so the planner treats it as a main. Tap Side to file it as a side dish."}
      </p>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3">
        <GenerateSideSheet recipeIds={[recipeId]} accompanies={recipeTitle} />
      </div>
    </div>
  );
}
