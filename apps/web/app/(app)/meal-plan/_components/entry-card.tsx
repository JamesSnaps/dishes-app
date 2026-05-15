"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Trash2, Clock, Users, Sun, Moon, Sunrise, Cookie, IceCreamCone, ChefHat } from "lucide-react";
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

const MEAL_BG: Record<MealType, string> = {
  breakfast: "bg-amber-50 dark:bg-amber-950/20",
  lunch: "bg-violet-50 dark:bg-violet-950/20",
  dinner: "bg-indigo-50 dark:bg-indigo-950/20",
  dessert: "bg-pink-50 dark:bg-pink-950/20",
  snack: "bg-muted/30",
};

function formatServings(servings: string | null): string | null {
  if (!servings) return null;
  const n = parseFloat(servings);
  if (isNaN(n)) return servings;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

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

  const totalTime = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
  const servings = formatServings(recipe.servings);

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(() => removeMealEntry(entry.id));
  }

  function handleNavigate() {
    router.push(`/recipes/${recipe.id}`);
  }

  return (
    <li
      className={`flex items-stretch rounded-xl border bg-card overflow-hidden shadow-sm transition-all cursor-pointer hover:shadow-md hover:bg-muted/20 ${pending ? "opacity-50" : ""}`}
      onClick={handleNavigate}
    >
      {recipe.imageUrl ? (
        <div className="flex-shrink-0 w-[120px] h-[120px]">
          <Image
            src={recipe.imageUrl}
            alt={recipe.title}
            width={120}
            height={120}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="flex-shrink-0 w-[120px] h-[120px] bg-muted flex items-center justify-center">
          <span className="text-3xl text-muted-foreground/30">🍽</span>
        </div>
      )}

      <div className="flex-1 min-w-0 px-4 py-3 flex flex-col justify-center gap-1">
        <div
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full w-fit ${MEAL_BG[entry.mealType]} ${MEAL_COLOR[entry.mealType]}`}
        >
          {MEAL_ICON[entry.mealType]}
          <span className="text-xs font-semibold">{MEAL_LABELS[entry.mealType]}</span>
        </div>

        <p className="font-bold text-base leading-snug line-clamp-2">{recipe.title}</p>

        {(totalTime > 0 || servings) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {totalTime > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {totalTime < 60
                  ? `${totalTime}m`
                  : `${Math.floor(totalTime / 60)}h${totalTime % 60 > 0 ? ` ${totalTime % 60}m` : ""}`}
              </span>
            )}
            {servings && (
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                Serves {servings}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex flex-col items-center justify-center gap-2 px-3 border-l">
        <button
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/recipes/${recipe.id}/cook`);
          }}
          disabled={pending}
          className="flex flex-col items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          aria-label={`Start cooking ${recipe.title}`}
        >
          <ChefHat className="h-5 w-5" />
          <span>Cook</span>
        </button>
        <button
          onClick={handleRemove}
          disabled={pending}
          className="flex items-center text-muted-foreground hover:text-destructive transition-colors"
          aria-label={`Remove ${recipe.title}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
