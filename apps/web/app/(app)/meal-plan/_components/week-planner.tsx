"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ShoppingCart,
  UtensilsCrossed,
  Sparkles,
  ShoppingBag,
  Bell,
  Users,
  Clock,
} from "lucide-react";
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
    imageUrl: string | null;
  };
};

type Recipe = {
  id: string;
  title: string;
  cuisine: string | null;
};

type TopIngredient = {
  name: string;
  count: number;
};

interface Props {
  weekStartDate: string;
  planId: string | null;
  entries: Entry[];
  recipes: Recipe[];
  isCurrentWeek: boolean;
  todayDayIndex: number; // 0=Mon … 6=Sun, -1 if not current week
  topIngredients: TopIngredient[];
  shoppingItemCount: number;
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
  topIngredients,
  shoppingItemCount,
}: Props) {
  const router = useRouter();

  const [expandedDays, setExpandedDays] = useState<Set<number>>(() => {
    const defaultDay =
      isCurrentWeek && todayDayIndex >= 0 ? todayDayIndex : 0;
    return new Set([defaultDay]);
  });

  const [shoppingPending, startShoppingTransition] = useTransition();

  const dayRefs = useRef<(HTMLDivElement | null)[]>([]);

  const prevWeek = addDays(weekStartDate, -7);
  const nextWeek = addDays(weekStartDate, 7);

  const totalMeals = entries.length;
  const totalTime = entries.reduce(
    (sum, e) =>
      sum + (e.recipe.prepTimeMinutes ?? 0) + (e.recipe.cookTimeMinutes ?? 0),
    0
  );

  const totalServings = entries.reduce((sum, e) => {
    const s = parseInt(e.recipe.servings ?? "0");
    return sum + (isNaN(s) ? 0 : s);
  }, 0);
  const avgServings =
    totalMeals > 0 ? Math.round(totalServings / totalMeals) : 0;

  function toggleDay(day: number) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function handleDayChipClick(dayIndex: number) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      next.add(dayIndex);
      return next;
    });
    setTimeout(() => {
      dayRefs.current[dayIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function handleGenerateShopping() {
    if (!planId) return;
    startShoppingTransition(() => generateShoppingFromWeek(planId));
  }

  return (
    <div className="p-4 lg:p-8">
      {/* Week navigation header */}
      <div className="mb-4 flex items-center gap-2">
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

        {!isCurrentWeek && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/meal-plan")}
          >
            Today
          </Button>
        )}

        <button
          onClick={() => router.push(`/meal-plan?week=${nextWeek}`)}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          aria-label="Next week"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Horizontal day strip */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 mb-4 scrollbar-hide">
        {Array.from({ length: 7 }, (_, i) => {
          const { short, date } = formatDayChip(weekStartDate, i);
          const isToday = isCurrentWeek && todayDayIndex === i;
          const hasMeals = entries.some((e) => e.dayOfWeek === i);
          return (
            <button
              key={i}
              onClick={() => handleDayChipClick(i)}
              className={`flex-shrink-0 flex flex-col items-center rounded-xl px-3 py-2 min-w-[3.5rem] border-2 transition-colors ${
                isToday
                  ? "border-orange-400 bg-orange-50 dark:bg-orange-950/20"
                  : "border-transparent bg-muted/50 hover:bg-muted"
              }`}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">
                {short}
              </span>
              <span
                className={`text-lg font-bold leading-none mt-0.5 ${isToday ? "text-orange-500" : ""}`}
              >
                {date}
              </span>
              <span
                className={`mt-1 h-1.5 w-1.5 rounded-full transition-colors ${
                  hasMeals
                    ? isToday
                      ? "bg-orange-400"
                      : "bg-primary/50"
                    : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* Stats overview bar */}
      <div className="rounded-xl border bg-card overflow-hidden mb-6">
        <div className="grid grid-cols-4 divide-x">
          <div className="flex flex-col items-center gap-1 px-3 py-3">
            <Bell className="h-4 w-4 text-violet-500" />
            <p className="text-xl font-bold leading-none text-violet-700 dark:text-violet-400">
              {totalMeals}
            </p>
            <p className="text-[10px] text-center text-muted-foreground leading-tight">
              Meals planned
            </p>
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-3">
            <Users className="h-4 w-4 text-emerald-500" />
            <p className="text-xl font-bold leading-none text-emerald-700 dark:text-emerald-400">
              {avgServings || "—"}
            </p>
            <p className="text-[10px] text-center text-muted-foreground leading-tight">
              Servings avg
            </p>
          </div>
          <div className="flex flex-col items-center gap-1 px-3 py-3">
            <Clock className="h-4 w-4 text-orange-500" />
            <p className="text-xl font-bold leading-none text-orange-700 dark:text-orange-400">
              {totalTime > 0 ? formatTotalTime(totalTime) : "—"}
            </p>
            <p className="text-[10px] text-center text-muted-foreground leading-tight">
              Total cook time
            </p>
          </div>
          <button
            onClick={() => router.push("/shopping")}
            className="flex flex-col items-center gap-1 px-3 py-3 hover:bg-muted/50 transition-colors relative"
          >
            <ShoppingCart className="h-4 w-4 text-blue-500" />
            <p className="text-xl font-bold leading-none text-blue-700 dark:text-blue-400">
              {shoppingItemCount || "—"}
            </p>
            <p className="text-[10px] text-center text-muted-foreground leading-tight">
              Items to buy
            </p>
            <ChevronRight className="h-3 w-3 text-muted-foreground absolute right-1.5 top-1/2 -translate-y-1/2" />
          </button>
        </div>
      </div>

      {/* Main layout: agenda + sidebar on desktop */}
      <div className="lg:grid lg:grid-cols-[1fr_272px] lg:gap-8 lg:items-start">
        {/* Agenda */}
        <div className="space-y-2">
          {Array.from({ length: 7 }, (_, i) => {
            const dayEntries = entries
              .filter((e) => e.dayOfWeek === i)
              .sort(
                (a, b) =>
                  MEAL_TYPE_ORDER.indexOf(a.mealType) -
                  MEAL_TYPE_ORDER.indexOf(b.mealType)
              );
            const isExpanded = expandedDays.has(i);
            const isToday = isCurrentWeek && todayDayIndex === i;
            const dayLabel = formatDayHeading(weekStartDate, i);

            return (
              <div
                key={i}
                ref={(el) => { dayRefs.current[i] = el; }}
                className="rounded-xl border bg-card overflow-hidden"
              >
                {/* Day header row */}
                <button
                  onClick={() => toggleDay(i)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm truncate ${isToday ? "text-orange-500" : ""}`}>
                      {dayLabel}
                    </p>
                  </div>

                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {dayEntries.length > 0
                      ? `${dayEntries.length} meal${dayEntries.length !== 1 ? "s" : ""}`
                      : "No meals"}
                  </span>

                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                </button>

                {/* Expanded day content */}
                {isExpanded && (
                  <div className="border-t px-3 py-3 space-y-3">
                    {dayEntries.length > 0 && (
                      <ul className="space-y-2">
                        {dayEntries.map((entry) => (
                          <EntryCard key={entry.id} entry={entry} />
                        ))}
                      </ul>
                    )}

                    {recipes.length > 0 ? (
                      <AddEntryDialog
                        weekStartDate={weekStartDate}
                        dayOfWeek={i}
                        dayLabel={dayLabel}
                        recipes={recipes}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Add some recipes first to start planning meals.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Desktop sidebar */}
        <div className="hidden lg:flex flex-col gap-4 sticky top-8">
          {/* Tools & Actions */}
          <div className="rounded-xl border bg-card p-4">
            <h3 className="font-semibold text-sm mb-3">Tools &amp; Actions</h3>
            <div className="space-y-2">
              <Button
                className="w-full justify-start gap-2 bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 border-0 text-white"
                onClick={() => router.push("/ai-concierge?tab=plan")}
              >
                <Sparkles className="h-4 w-4" />
                Generate Plan
              </Button>

              {totalMeals > 0 && planId ? (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={handleGenerateShopping}
                  disabled={shoppingPending}
                >
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  {shoppingPending ? "Adding to list…" : "Generate shopping list"}
                </Button>
              ) : (
                <div className="flex items-start gap-2 text-sm text-muted-foreground pt-1">
                  <UtensilsCrossed className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>Add meals to generate a shopping list.</p>
                </div>
              )}
            </div>
          </div>

          {/* Top Ingredients */}
          {topIngredients.length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Top Ingredients</h3>
              </div>
              <div className="space-y-1.5">
                {topIngredients.map(({ name, count }) => (
                  <div key={name} className="flex items-center justify-between gap-2">
                    <span className="text-sm capitalize truncate">{name}</span>
                    {count > 1 && (
                      <span className="text-xs shrink-0 rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5">
                        ×{count}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: generate shopping list */}
      {totalMeals > 0 && planId && (
        <div className="mt-6 lg:hidden">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleGenerateShopping}
            disabled={shoppingPending}
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            {shoppingPending ? "Adding to list…" : "Generate shopping list"}
          </Button>
        </div>
      )}
    </div>
  );
}
