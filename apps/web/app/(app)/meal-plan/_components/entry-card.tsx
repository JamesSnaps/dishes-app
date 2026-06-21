"use client";

import { useState, useTransition } from "react";
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
  GripVertical,
  ShoppingCart,
  Check,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
} from "@dishes/ui";
import { removeMealEntry, moveMealEntry, changeMealEntryType, addMealEntryToShoppingList, updateMealEntryServings } from "@/app/actions/meal-plan";

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

function formatServings(servings: string | null): number | null {
  if (!servings) return null;
  const n = parseFloat(servings);
  return isNaN(n) ? null : Math.round(n * 10) / 10;
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
    entryServings: string | null;
    addedToShoppingListAt: Date | null;
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
  dragNodeRef?: (node: HTMLLIElement | null) => void;
  dragListeners?: Record<string, unknown>;
  dragAttributes?: Record<string, unknown>;
  isDragging?: boolean;
}

export function EntryCard({ entry, weekStartDate, dragNodeRef, dragListeners, dragAttributes, isDragging }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { recipe } = entry;

  const [servingsOpen, setServingsOpen] = useState(false);
  const [servingsInput, setServingsInput] = useState("");

  const totalTime = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);

  // Effective servings: entry override takes precedence over recipe default
  const baseServings = formatServings(recipe.servings);
  const overrideServings = formatServings(entry.entryServings);
  const effectiveServings = overrideServings ?? baseServings;
  const isOverridden = overrideServings !== null;
  const onShoppingList = entry.addedToShoppingListAt != null;

  function handleRemove() {
    startTransition(() => removeMealEntry(entry.id));
  }

  function handleMove(newDay: number) {
    startTransition(() => moveMealEntry(entry.id, newDay));
  }

  function handleChangeType(newType: MealType) {
    startTransition(() => changeMealEntryType(entry.id, newType));
  }

  function handleAddToShopping() {
    startTransition(() => addMealEntryToShoppingList(entry.id));
  }

  function handleOpenServings() {
    setServingsInput(effectiveServings !== null ? String(effectiveServings) : "");
    setServingsOpen(true);
  }

  function handleSaveServings() {
    const n = parseFloat(servingsInput);
    const val = !isNaN(n) && n > 0 ? n : null;
    startTransition(() => updateMealEntryServings(entry.id, val));
    setServingsOpen(false);
  }

  function handleResetServings() {
    startTransition(() => updateMealEntryServings(entry.id, null));
    setServingsOpen(false);
  }

  function handleNavigate() {
    router.push(`/recipes/${recipe.id}?from=meal-plan&week=${weekStartDate}`);
  }

  return (
    <>
      <li
        ref={dragNodeRef}
        {...(dragAttributes ?? {})}
        className={`flex items-stretch rounded-xl border bg-card overflow-hidden shadow-sm transition-all ${
          pending || isDragging
            ? "opacity-40"
            : "cursor-pointer hover:shadow-md hover:bg-muted/20"
        }`}
        onClick={handleNavigate}
      >
        {/* Drag handle */}
        {dragListeners && (
          <div
            {...dragListeners}
            className="flex-shrink-0 flex items-center justify-center px-2 cursor-grab active:cursor-grabbing touch-none text-muted-foreground/25 hover:text-muted-foreground/60 transition-colors"
            onClick={(e) => e.stopPropagation()}
            aria-label="Drag to move to another day"
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}

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
          <div className="flex items-center gap-1.5 flex-wrap">
            <div
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full w-fit ${MEAL_BG[entry.mealType]} ${MEAL_COLOR[entry.mealType]}`}
            >
              {MEAL_ICON[entry.mealType]}
              <span className="text-xs font-semibold">{MEAL_LABELS[entry.mealType]}</span>
            </div>
            {onShoppingList && (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full w-fit bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                <Check className="h-3 w-3" />
                <span className="text-xs font-semibold">On list</span>
              </div>
            )}
          </div>

          <p className="font-bold text-base leading-snug line-clamp-2">{recipe.title}</p>

          {(totalTime > 0 || effectiveServings) && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {totalTime > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {totalTime < 60
                    ? `${totalTime}m`
                    : `${Math.floor(totalTime / 60)}h${totalTime % 60 > 0 ? ` ${totalTime % 60}m` : ""}`}
                </span>
              )}
              {effectiveServings && (
                <span className={`flex items-center gap-1 ${isOverridden ? "text-orange-500 font-medium" : ""}`}>
                  <Users className="h-3.5 w-3.5" />
                  Serves {effectiveServings}
                  {isOverridden && <span className="text-[10px]">✎</span>}
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

              <DropdownMenuItem onClick={handleAddToShopping}>
                <ShoppingCart className="h-4 w-4 mr-2" />
                {onShoppingList ? "Add to shopping list again" : "Add to shopping list"}
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleOpenServings}>
                <Users className="h-4 w-4 mr-2" />
                Change servings{isOverridden && ` (${effectiveServings})`}
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

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span className={`mr-2 ${MEAL_COLOR[entry.mealType]}`}>{MEAL_ICON[entry.mealType]}</span>
                  Change meal type…
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {(Object.keys(MEAL_LABELS) as MealType[]).map((type) => (
                    <DropdownMenuItem
                      key={type}
                      disabled={type === entry.mealType}
                      onClick={() => handleChangeType(type)}
                      className={type === entry.mealType ? "opacity-50" : ""}
                    >
                      <span className={`mr-2 ${MEAL_COLOR[type]}`}>{MEAL_ICON[type]}</span>
                      {MEAL_LABELS[type]}
                      {type === entry.mealType && (
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

      <Dialog open={servingsOpen} onOpenChange={setServingsOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Change servings</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground line-clamp-1">{recipe.title}</p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min="1"
                step="1"
                value={servingsInput}
                onChange={(e) => setServingsInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveServings()}
                className="w-24 text-center text-lg font-bold"
                autoFocus
              />
              <span className="text-sm text-muted-foreground">servings</span>
            </div>
            {baseServings && (
              <p className="text-xs text-muted-foreground">
                Recipe default: {baseServings} servings
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {isOverridden && (
              <Button variant="ghost" size="sm" onClick={handleResetServings} className="mr-auto">
                Reset to default
              </Button>
            )}
            <Button onClick={handleSaveServings} disabled={!servingsInput || parseFloat(servingsInput) <= 0}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
