"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ShoppingCart } from "lucide-react";
import { Button } from "@dishes/ui";
import { generateShoppingFromWeek } from "@/app/actions/meal-plan";
import { AddEntryDialog } from "./add-entry-dialog";
import { EntryCard } from "./entry-card";

type MealType = "breakfast" | "lunch" | "dinner" | "snack";
const MEAL_TYPE_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

type Entry = {
  id: string;
  dayOfWeek: number;
  mealType: MealType;
  recipe: {
    id: string;
    title: string;
    prepTimeMinutes: number | null;
    cookTimeMinutes: number | null;
    servings: string | null;
  };
};

type Recipe = {
  id: string;
  title: string;
  cuisine: string | null;
};

interface Props {
  weekStartDate: string;
  planId: string | null;
  entries: Entry[];
  recipes: Recipe[];
  isCurrentWeek: boolean;
  todayDayIndex: number; // 0=Mon … 6=Sun, -1 if not current week
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDayChip(
  weekStart: string,
  dayIndex: number
): { short: string; date: string } {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() + dayIndex);
  return {
    short: d.toLocaleDateString("en-GB", { weekday: "short" }),
    date: String(d.getDate()),
  };
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00");
  const end = new Date(weekStart + "T00:00:00");
  end.setDate(end.getDate() + 6);
  const s = start.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  const e = end.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${s} – ${e}`;
}

function formatDayHeading(weekStart: string, dayIndex: number): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatTotalTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function WeekPlanner({
  weekStartDate,
  planId,
  entries,
  recipes,
  isCurrentWeek,
  todayDayIndex,
}: Props) {
  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState<number>(
    isCurrentWeek && todayDayIndex >= 0 ? todayDayIndex : 0
  );
  const [shoppingPending, startShoppingTransition] = useTransition();

  const prevWeek = addDays(weekStartDate, -7);
  const nextWeek = addDays(weekStartDate, 7);

  const dayEntries = entries
    .filter((e) => e.dayOfWeek === selectedDay)
    .sort(
      (a, b) =>
        MEAL_TYPE_ORDER.indexOf(a.mealType) -
        MEAL_TYPE_ORDER.indexOf(b.mealType)
    );

  const totalMeals = entries.length;
  const totalTime = entries.reduce(
    (sum, e) =>
      sum + (e.recipe.prepTimeMinutes ?? 0) + (e.recipe.cookTimeMinutes ?? 0),
    0
  );

  const dayLabel = formatDayHeading(weekStartDate, selectedDay);

  function handleGenerateShopping() {
    if (!planId) return;
    startShoppingTransition(() => generateShoppingFromWeek(planId));
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      {/* Week header */}
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/meal-plan?week=${prevWeek}`)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div className="flex-1">
            <h1 className="text-xl font-bold leading-tight">
              {isCurrentWeek ? "This Week" : "Meal Plan"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {formatWeekRange(weekStartDate)}
            </p>
          </div>

          <button
            onClick={() => router.push(`/meal-plan?week=${nextWeek}`)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="Next week"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {!isCurrentWeek && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/meal-plan")}
            >
              Today
            </Button>
          )}
        </div>

        {totalMeals > 0 && (
          <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
            <span>
              <strong className="text-foreground">{totalMeals}</strong> meals
            </span>
            {totalTime > 0 && (
              <span>
                <strong className="text-foreground">
                  {formatTotalTime(totalTime)}
                </strong>{" "}
                total cook time
              </span>
            )}
          </div>
        )}
      </div>

      {/* Day tab strip */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1 -mx-1 px-1">
        {Array.from({ length: 7 }, (_, i) => {
          const { short, date } = formatDayChip(weekStartDate, i);
          const dayMeals = entries.filter((e) => e.dayOfWeek === i).length;
          const isSelected = selectedDay === i;
          const isToday = isCurrentWeek && todayDayIndex === i;
          return (
            <button
              key={i}
              onClick={() => setSelectedDay(i)}
              className={`flex-shrink-0 flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition-colors min-w-[3rem] ${
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : isToday
                    ? "ring-2 ring-primary hover:bg-muted"
                    : "hover:bg-muted"
              }`}
            >
              <span className="text-xs font-medium">{short}</span>
              <span className="text-base font-bold leading-none">{date}</span>
              <span className="h-1.5 flex items-center justify-center">
                {dayMeals > 0 && (
                  <span
                    className={`block h-1 w-1 rounded-full ${
                      isSelected ? "bg-primary-foreground/70" : "bg-primary"
                    }`}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Day content */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-base">{dayLabel}</h2>
          {dayEntries.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {dayEntries.length} meal{dayEntries.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {dayEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No meals planned yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3 mb-4">
            {dayEntries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </ul>
        )}

        {recipes.length > 0 ? (
          <AddEntryDialog
            weekStartDate={weekStartDate}
            dayOfWeek={selectedDay}
            dayLabel={dayLabel}
            recipes={recipes}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Add some recipes first to start planning meals.
          </p>
        )}
      </div>

      {/* Generate shopping list */}
      {totalMeals > 0 && planId && (
        <div className="mt-8 pt-6 border-t flex justify-center">
          <Button
            variant="outline"
            onClick={handleGenerateShopping}
            disabled={shoppingPending}
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            {shoppingPending
              ? "Adding to shopping list…"
              : "Generate shopping list"}
          </Button>
        </div>
      )}
    </div>
  );
}
