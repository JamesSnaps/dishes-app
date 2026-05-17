"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  Users,
  Sun,
  Moon,
  Sunrise,
  Cookie,
  IceCreamCone,
  ChefHat,
  MoreVertical,
  Trash2,
  CalendarDays,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@dishes/ui";
import { removeMealEntry, moveMealEntry } from "@/app/actions/meal-plan";

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

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function formatServings(servings: string | null): string | null {
  if (!servings) return null;
  const n = parseFloat(servings);
  if (isNaN(n)) return servings;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function getDayLabel(weekStartDate: string, dayIndex: number): string {
  const d = new Date(weekStartDate + "T00:00:00");
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
}

interface Props {
  entry: {
    id: string;
    dayOfWeek: number;
    mealType: MealType;
    recipe: {
      id: string;
      title: string;
      prepTimeMinutes: number | null;
      cookTimeMinutes: number | null;
      servings: string | null;
      imageUrl: string | null;
      thumbnailUrl: string | null;
    };
  };
  weekStartDate: string;
}

export function EntryCard({ entry, weekStartDate }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { recipe } = entry;

  const totalTime = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
  const servings = formatServings(recipe.servings);

  function handleRemove() {
    startTransition(() => removeMealEntry(entry.id));
  }

  function handleMove(newDay: number) {
    startTransition(() => moveMealEntry(entry.id, newDay));
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={recipe.thumbnailUrl ?? recipe.imageUrl}
            alt={recipe.title}
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

      <div className="flex-shrink-0 flex flex-col items-center justify-center px-2 border-l">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              disabled={pending}
              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Meal options"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem
              onClick={() => router.push(`/recipes/${recipe.id}/cook`)}
            >
              <ChefHat className="h-4 w-4 mr-2" />
              Cook
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <CalendarDays className="h-4 w-4 mr-2" />
                Move to…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {DAY_NAMES.map((name, i) => (
                  <DropdownMenuItem
                    key={i}
                    disabled={i === entry.dayOfWeek}
                    onClick={() => handleMove(i)}
                    className={i === entry.dayOfWeek ? "opacity-50" : ""}
                  >
                    <span className="w-5 text-[10px] font-semibold text-muted-foreground uppercase mr-2">
                      {getDayLabel(weekStartDate, i).split(" ")[0]}
                    </span>
                    {name}
                    {i === entry.dayOfWeek && (
                      <span className="ml-auto text-xs text-muted-foreground">current</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={handleRemove}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
