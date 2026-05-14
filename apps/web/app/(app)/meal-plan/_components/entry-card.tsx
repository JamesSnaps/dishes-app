"use client";

import { useTransition } from "react";
import { Trash2, Clock, Users } from "lucide-react";
import { Badge } from "@dishes/ui";
import { removeMealEntry } from "@/app/actions/meal-plan";

type MealType = "breakfast" | "lunch" | "dinner" | "snack";

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

const MEAL_BADGE_VARIANT: Record<
  MealType,
  "default" | "secondary" | "outline"
> = {
  breakfast: "secondary",
  lunch: "outline",
  dinner: "default",
  snack: "secondary",
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
      className={`flex items-start gap-3 rounded-xl border bg-card p-3 transition-opacity ${pending ? "opacity-50" : ""}`}
    >
      <div className="flex-1 min-w-0">
        <Badge
          variant={MEAL_BADGE_VARIANT[entry.mealType]}
          className="mb-1.5 text-xs"
        >
          {MEAL_LABELS[entry.mealType]}
        </Badge>
        <p className="font-semibold leading-snug truncate">{recipe.title}</p>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
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
