"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Clock, Users, Sun, Moon, Sunrise, Cookie, IceCreamCone } from "lucide-react";
import { removeMealEntry } from "@/app/actions/meal-plan";

type MealType = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
};

const MEAL_ICON: Record<MealType, React.ReactNode> = {
  breakfast: <Sunrise className="h-3.5 w-3.5" />,
  lunch: <Sun className="h-3.5 w-3.5" />,
  dinner: <Moon className="h-3.5 w-3.5" />,
  dessert: <IceCreamCone className="h-3.5 w-3.5" />,
  snack: <Cookie className="h-3.5 w-3.5" />,
};

const MEAL_COLOR: Record<MealType, string> = {
  breakfast: "text-amber-500",
  lunch: "text-violet-500",
  dinner: "text-indigo-500",
  dessert: "text-pink-500",
  snack: "text-muted-foreground",
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
      imageUrl: string | null;
    };
  };
}

export function EntryCard({ entry }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { recipe } = entry;

  const totalTime =
    (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(() => removeMealEntry(entry.id));
  }

  function handleNavigate() {
    router.push(`/recipes/${recipe.id}`);
  }

  return (
    <li
      className={`flex items-stretch rounded-xl border bg-card overflow-hidden transition-opacity cursor-pointer hover:bg-muted/30 ${pending ? "opacity-50" : ""}`}
      onClick={handleNavigate}
    >
      {recipe.imageUrl ? (
        <div className="flex-shrink-0 w-[88px] h-[88px]">
          <img
            src={recipe.imageUrl}
            alt={recipe.title}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="flex-shrink-0 w-[88px] h-[88px] bg-muted flex items-center justify-center">
          <span className="text-2xl text-muted-foreground/30">🍽</span>
        </div>
      )}

      <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col justify-center">
        <div className={`flex items-center gap-1 mb-0.5 ${MEAL_COLOR[entry.mealType]}`}>
          {MEAL_ICON[entry.mealType]}
          <span className="text-xs font-semibold">
            {MEAL_LABELS[entry.mealType]}
          </span>
        </div>

        <p className="font-bold text-sm leading-snug truncate">{recipe.title}</p>

        {(totalTime > 0 || recipe.servings) && (
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
        )}
      </div>

      <button
        onClick={handleRemove}
        disabled={pending}
        className="flex-shrink-0 px-3 flex items-center text-muted-foreground hover:text-destructive transition-colors"
        aria-label={`Remove ${recipe.title}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
