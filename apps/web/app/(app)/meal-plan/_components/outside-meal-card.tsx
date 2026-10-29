"use client";

import { ChevronRight } from "lucide-react";
import { OUTSIDE_MEAL_KIND_LABELS } from "@dishes/shared";
import { OUTSIDE_MEAL_KIND_ICON } from "@/components/outside-meals/outside-meal-sheet";
import {
  isOutsideMealDescribed,
  outsideMealCoverPhoto,
  outsideMealLabel,
  type OutsideMealView,
} from "@/lib/outside-meals";

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
  const described = isOutsideMealDescribed(meal);
  const photo = outsideMealCoverPhoto(meal);
  const courses = meal.kind !== "skipped" && meal.courses.length > 1 ? `${meal.courses.length} courses · ` : "";
  const detail =
    courses +
    (meal.kind === "skipped"
      ? "Not eaten"
      : meal.calories != null
        ? `${meal.nutritionSource === "manual" ? "" : "≈ "}${meal.calories.toLocaleString()} kcal${
            meal.saturatedFatG != null ? ` · ${meal.saturatedFatG} g sat fat` : ""
          }`
        : isPast
          ? described
            ? "No nutrition yet — tap to estimate"
            : "Tap to add what you had"
          : "No reminder · the AI planner leaves this slot");

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-2xl bg-card px-3 py-3 text-left transition-all hover:shadow-md"
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="h-12 w-12 flex-shrink-0 rounded-xl object-cover" />
        ) : (
          // DESIGN.md → Planner: eating out is a fork-and-knife tile and an italic place name.
          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-plate text-foreground/70">
            <Icon className="h-6 w-6" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-muted-foreground">
            {MEAL_TYPE_LABEL[meal.mealType]} · {kindLabel}
          </span>
          <span className="block truncate font-serif text-[17px] font-semibold italic leading-snug">{outsideMealLabel(meal, kindLabel)}</span>
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
