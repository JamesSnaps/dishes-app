"use client";

import { useTransition } from "react";
import { Trash2, Clock, Users } from "lucide-react";
import { removeMealEntry } from "@/app/actions/meal-plan";

type MealType = "breakfast" | "lunch" | "dinner" | "snack";

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

const MEAL_DOT_COLOR: Record<MealType, string> = {
  breakfast: "bg-amber-400",
  lunch: "bg-sky-400",
  dinner: "bg-primary",
  snack: "bg-muted-foreground",
};

interface Props {
  entry: {
    id: string;
    mealType: MealType;
    recipe: {
      id: string;
      title: string;
      prepTimeMinutes: number | null;
      cookTimeMinutes: number | null;
      servings: string | null;
    };
  };
}

export function EntryCard({ entry }: Props) {
  const [pending, startTransition] = useTransition();
  const { recipe } = entry;

  const totalTime =
    (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);

  function handleRemove() {
    startTransition(() => removeMealEntry(entry.id));
  }

  return (
    <li
      className={`flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 transition-opacity ${pending ? "opacity-50" : ""}`}
    >
      <span
        className={`flex-shrink-0 h-2 w-2 rounded-full ${MEAL_DOT_COLOR[entry.mealType]}`}
        title={MEAL_LABELS[entry.mealType]}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="font-semibold text-sm leading-snug truncate">
            {recipe.title}
          </p>
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {MEAL_LABELS[entry.mealType]}
          </span>
        </div>

        {(totalTime > 0 || recipe.servings) && (
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            {totalTime > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {totalTime < 60
                  ? `${totalTime}m`
                  : `${Math.floor(totalTime / 60)}h${totalTime % 60 > 0 ? ` ${totalTime % 60}m` : ""}`}
              </span>
            )}
            {recipe.servings && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                Serves {recipe.servings}
              </span>
            )}
          </div>
        )}
      </div>

      <button
        onClick={handleRemove}
        disabled={pending}
        className="flex-shrink-0 p-1 text-muted-foreground hover:text-destructive transition-colors"
        aria-label={`Remove ${recipe.title}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
