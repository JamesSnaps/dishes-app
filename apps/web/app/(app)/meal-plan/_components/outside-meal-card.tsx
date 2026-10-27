"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@dishes/ui";
import { OUTSIDE_MEAL_KIND_LABELS, type OutsideMealKind } from "@dishes/shared";
import { OUTSIDE_MEAL_KIND_ICON } from "@/components/outside-meals/outside-meal-sheet";
import { outsideMealLabel, type OutsideMealView } from "@/lib/outside-meals";

const KIND_STYLE: Record<OutsideMealKind, string> = {
  eat_out:
    "border-amber-300/70 from-amber-100 via-orange-50 to-rose-100 dark:border-amber-800/60 dark:from-amber-950/60 dark:via-orange-950/30 dark:to-rose-950/40",
  takeaway:
    "border-violet-300/70 from-violet-100 via-fuchsia-50 to-pink-100 dark:border-violet-800/60 dark:from-violet-950/60 dark:via-fuchsia-950/30 dark:to-pink-950/40",
  at_friends:
    "border-emerald-300/70 from-emerald-100 via-teal-50 to-sky-100 dark:border-emerald-800/60 dark:from-emerald-950/60 dark:via-teal-950/30 dark:to-sky-950/40",
  skipped:
    "border-slate-300/70 from-slate-100 via-slate-50 to-zinc-100 dark:border-slate-700/60 dark:from-slate-900/60 dark:via-slate-900/30 dark:to-zinc-900/40",
};

const ICON_STYLE: Record<OutsideMealKind, string> = {
  eat_out: "bg-gradient-to-br from-amber-500 to-rose-500",
  takeaway: "bg-gradient-to-br from-violet-500 to-pink-500",
  at_friends: "bg-gradient-to-br from-emerald-500 to-sky-500",
  skipped: "bg-gradient-to-br from-slate-400 to-zinc-500",
};

const MEAL_TYPE_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
};

/**
 * A meal not cooked from the plan, in the day's list. Tapping it opens the
 * sheet to edit it, or — for a plan whose day has come — to log what was had.
 */
export function OutsideMealCard({
  meal,
  isPast,
  onOpen,
}: {
  meal: OutsideMealView;
  /** The day has come: an unlogged plan asks for what was eaten. */
  isPast: boolean;
  onOpen: () => void;
}) {
  const Icon = OUTSIDE_MEAL_KIND_ICON[meal.kind];
  const kindLabel = OUTSIDE_MEAL_KIND_LABELS[meal.kind];
  const described = !!(meal.title || meal.description || meal.menuText || meal.photoUrl);
  const detail =
    meal.kind === "skipped"
      ? "Not eaten"
      : meal.calories != null
        ? `${meal.nutritionSource === "manual" ? "" : "≈ "}${meal.calories.toLocaleString()} kcal${
            meal.saturatedFatG != null ? ` · ${meal.saturatedFatG} g sat fat` : ""
          }`
        : isPast
          ? described
            ? "No nutrition yet — tap to estimate"
            : "Tap to add what you had"
          : "No reminder · the AI planner leaves this slot";

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border bg-gradient-to-br px-3 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
          KIND_STYLE[meal.kind]
        )}
      >
        {meal.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meal.photoUrl} alt="" className="h-12 w-12 flex-shrink-0 rounded-lg object-cover shadow" />
        ) : (
          <span
            className={cn(
              "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg text-white shadow",
              ICON_STYLE[meal.kind]
            )}
          >
            <Icon className="h-6 w-6" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-muted-foreground">
            {MEAL_TYPE_LABEL[meal.mealType]} · {kindLabel}
          </span>
          <span className="block truncate font-bold leading-snug">{outsideMealLabel(meal, kindLabel)}</span>
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
