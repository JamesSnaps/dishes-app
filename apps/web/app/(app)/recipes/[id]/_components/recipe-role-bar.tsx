/**
 * What part a recipe plays in a meal, as a badge in the recipe's meta row.
 * Tapping it opens a small dialog to change the role, or to ask the AI to
 * draft a side that goes with it.
 *
 * Example: open a cottage pie, tap its "Main" badge and pick Side to file it
 * as a side, or tap Generate a side dish to draft peas as a new recipe with
 * the Side role already set.
 */
"use client";

import { useState, useTransition } from "react";
import { Pencil, Salad, Utensils } from "lucide-react";
import { MEAL_ROLES, MEAL_ROLE_LABELS, type MealRole } from "@dishes/shared";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dishes/ui";
import { setRecipeMealRole } from "@/app/actions/recipes";
import { GenerateSideSheet } from "@/components/meals/generate-side-sheet";

export function RecipeRoleBadge({
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
  const [open, setOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);

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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Change what kind of dish this is"
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
          role
            ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm hover:from-orange-600 hover:to-rose-600"
            : "border border-dashed border-orange-400/70 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/40"
        )}
      >
        <Utensils className="h-3 w-3" />
        {role ? MEAL_ROLE_LABELS[role] : "Set dish type"}
        <Pencil className="h-3 w-3 opacity-80" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>What kind of dish is this?</DialogTitle>
            <DialogDescription>
              Sides, sauces and extras stay out of the planner&apos;s standalone slots.
            </DialogDescription>
          </DialogHeader>
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
                      ? "rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm"
                      : "rounded-full border border-orange-300/80 bg-orange-50 px-4 py-1.5 text-sm font-medium text-orange-900 shadow-sm hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200 dark:hover:bg-orange-950/70"
                  }
                >
                  {MEAL_ROLE_LABELS[option]}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {role
              ? `${MEAL_ROLE_LABELS[role]}. Tap it again to clear.`
              : "Not marked yet, so the planner treats it as a main."}
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            onClick={() => {
              setOpen(false);
              setSideOpen(true);
            }}
            className="w-fit gap-2 bg-gradient-to-r from-emerald-500 to-lime-600 text-white shadow-sm hover:from-emerald-600 hover:to-lime-700"
          >
            <Salad className="h-4 w-4" />
            Generate a side dish
          </Button>
        </DialogContent>
      </Dialog>

      <GenerateSideSheet
        recipeIds={[recipeId]}
        accompanies={recipeTitle}
        open={sideOpen}
        onOpenChange={setSideOpen}
        hideTrigger
      />
    </>
  );
}
