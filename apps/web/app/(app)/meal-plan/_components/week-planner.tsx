"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
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

type MealType = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";
const MEAL_TYPE_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "dessert", "snack"];

const MEAL_TYPE_COLOR: Record<MealType, string> = {
  breakfast: "#f59e0b",
  lunch: "#8b5cf6",
  dinner: "#6366f1",
  dessert: "#ec4899",
  snack: "#94a3b8",
};

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
    thumbnailUrl: string | null;
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
  todayDayIndex: number;
  topIngredients: TopIngredient[];
  shoppingItemCount: number;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayChip(weekStart: string, dayIndex: number): { short: string; date: string } {
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
  const s = start.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const e = end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${s} – ${e}`;
}

function formatDayHeading(weekStart: string, dayIndex: number): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function formatTotalTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// SVG donut chart for meal type breakdown
function MealTypePieChart({ entries }: { entries: Entry[] }) {
  const counts: Partial<Record<MealType, number>> = {};
  for (const e of entries) {
    counts[e.mealType] = (counts[e.mealType] ?? 0) + 1;
  }

  const types = Object.entries(counts) as [MealType, number][];
  const total = entries.length;

  if (total === 0) return null;

  const SIZE = 80;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = 28;
  const innerR = 16;

  let cumAngle = -Math.PI / 2;
  const slices = types.map(([type, count]) => {
    const angle = (count / total) * 2 * Math.PI;
    const start = cumAngle;
    cumAngle += angle;
    return { type, count, start, end: cumAngle, angle };
  });

  function polarToXY(angle: number, radius: number) {
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  }

  function slicePath(start: number, end: number) {
    const s1 = polarToXY(start, r);
    const e1 = polarToXY(end, r);
    const s2 = polarToXY(end, innerR);
    const e2 = polarToXY(start, innerR);
    const large = end - start > Math.PI ? 1 : 0;
    return [
      `M ${s1.x} ${s1.y}`,
      `A ${r} ${r} 0 ${large} 1 ${e1.x} ${e1.y}`,
      `L ${s2.x} ${s2.y}`,
      `A ${innerR} ${innerR} 0 ${large} 0 ${e2.x} ${e2.y}`,
      "Z",
    ].join(" ");
  }

  const MEAL_LABELS: Record<MealType, string> = {
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    dessert: "Dessert",
    snack: "Snacks",
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="font-semibold text-sm mb-3">Week Overview</h3>
      <div className="flex items-center gap-4">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="flex-shrink-0">
          {slices.map(({ type, start, end }) => (
            <path
              key={type}
              d={slicePath(start, end)}
              fill={MEAL_TYPE_COLOR[type]}
              className="opacity-90"
            />
          ))}
          <text
            x={cx}
            y={cy + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="11"
            fontWeight="700"
            fill="currentColor"
            className="fill-foreground"
          >
            {total}
          </text>
          <text
            x={cx}
            y={cy + 10}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="6"
            fill="currentColor"
            className="fill-muted-foreground"
          >
            meals
          </text>
        </svg>
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          {slices.map(({ type, count }) => (
            <div key={type} className="flex items-center gap-2">
              <span
                className="flex-shrink-0 h-2 w-2 rounded-full"
                style={{ backgroundColor: MEAL_TYPE_COLOR[type] }}
              />
              <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
                {MEAL_LABELS[type]}
              </span>
              <span className="text-xs font-semibold tabular-nums">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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

  const [selectedDay, setSelectedDay] = useState<number>(() =>
    isCurrentWeek && todayDayIndex >= 0 ? todayDayIndex : 0
  );

  useEffect(() => {
    setSelectedDay(isCurrentWeek && todayDayIndex >= 0 ? todayDayIndex : 0);
  }, [weekStartDate, isCurrentWeek, todayDayIndex]);

  const [shoppingPending, startShoppingTransition] = useTransition();

  const prevWeek = addDays(weekStartDate, -7);
  const nextWeek = addDays(weekStartDate, 7);

  function navigate(target: string, direction: "prev" | "next") {
    console.debug("[meal-plan] navigate", { direction, from: weekStartDate, to: target });
    router.push(`/meal-plan?week=${target}`);
  }

  const totalMeals = entries.length;
  const totalTime = entries.reduce(
    (sum, e) => sum + (e.recipe.prepTimeMinutes ?? 0) + (e.recipe.cookTimeMinutes ?? 0),
    0
  );
  const totalServings = entries.reduce((sum, e) => {
    const s = parseInt(e.recipe.servings ?? "0");
    return sum + (isNaN(s) ? 0 : s);
  }, 0);
  const avgServings = totalMeals > 0 ? Math.round(totalServings / totalMeals) : 0;

  const selectedDayEntries = entries
    .filter((e) => e.dayOfWeek === selectedDay)
    .sort((a, b) => MEAL_TYPE_ORDER.indexOf(a.mealType) - MEAL_TYPE_ORDER.indexOf(b.mealType));

  const selectedDayLabel = formatDayHeading(weekStartDate, selectedDay);
  const isToday = isCurrentWeek && todayDayIndex === selectedDay;

  function handleGenerateShopping() {
    if (!planId) return;
    startShoppingTransition(() => generateShoppingFromWeek(planId));
  }

  return (
    <div className="p-4 lg:p-8">
      {/* Week navigation header */}
      <div className="mb-4">
        <div className="flex items-start justify-between mb-0.5">
          <h1 className="text-xl font-bold leading-tight">
            {isCurrentWeek ? "This Week" : "Meal Plan"}
          </h1>
          {!isCurrentWeek && (
            <Button variant="ghost" size="sm" onClick={() => router.push("/meal-plan")}>
              Today
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{formatWeekRange(weekStartDate)}</p>
      </div>

      {/* Horizontal day strip with prev/next flanking */}
      <div className="flex items-center gap-1 mb-5">
        <button
          onClick={() => navigate(prevWeek, "prev")}
          className="flex-shrink-0 p-1.5 rounded-lg hover:bg-muted transition-colors"
          aria-label="Previous week"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <div className="flex flex-1 gap-2 overflow-x-auto pb-2 -mb-2 scrollbar-hide">
        {Array.from({ length: 7 }, (_, i) => {
          const { short, date } = formatDayChip(weekStartDate, i);
          const isTodayChip = isCurrentWeek && todayDayIndex === i;
          const isSelected = selectedDay === i;
          const hasMeals = entries.some((e) => e.dayOfWeek === i);

          return (
            <button
              key={i}
              onClick={() => setSelectedDay(i)}
              className={`flex-shrink-0 flex flex-col items-center rounded-xl px-3 py-2.5 min-w-[3.75rem] border-2 transition-all ${
                isSelected
                  ? isTodayChip
                    ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30 shadow-sm"
                    : "border-primary bg-primary/5 shadow-sm"
                  : isTodayChip
                    ? "border-orange-300/60 bg-orange-50/50 dark:bg-orange-950/10"
                    : "border-transparent bg-muted/40 hover:bg-muted"
              }`}
            >
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide leading-none ${
                  isSelected ? (isTodayChip ? "text-orange-500" : "text-primary") : "text-muted-foreground"
                }`}
              >
                {short}
              </span>
              <span
                className={`text-xl font-bold leading-none mt-1 ${
                  isSelected
                    ? isTodayChip
                      ? "text-orange-500"
                      : "text-primary"
                    : isTodayChip
                      ? "text-orange-400"
                      : ""
                }`}
              >
                {date}
              </span>
              <span
                className={`mt-1.5 h-1.5 w-1.5 rounded-full transition-colors ${
                  hasMeals
                    ? isTodayChip
                      ? "bg-orange-400"
                      : "bg-primary/60"
                    : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
        </div>

        <button
          onClick={() => navigate(nextWeek, "next")}
          className="flex-shrink-0 p-1.5 rounded-lg hover:bg-muted transition-colors"
          aria-label="Next week"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Stats bar — icon left, value + label right */}
      <div className="rounded-xl border bg-card overflow-hidden mb-6 shadow-sm">
        <div className="grid grid-cols-4 divide-x">
          <div className="flex items-center gap-2.5 px-3 py-3">
            <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center">
              <Bell className="h-4 w-4 text-violet-500" />
            </div>
            <div>
              <p className="text-lg font-bold leading-none text-violet-700 dark:text-violet-400">
                {totalMeals || "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Meals</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 px-3 py-3">
            <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
              <Users className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-lg font-bold leading-none text-emerald-700 dark:text-emerald-400">
                {avgServings || "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Avg serves</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 px-3 py-3">
            <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-orange-100 dark:bg-orange-950/40 flex items-center justify-center">
              <Clock className="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <p className="text-lg font-bold leading-none text-orange-700 dark:text-orange-400">
                {totalTime > 0 ? formatTotalTime(totalTime) : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Cook time</p>
            </div>
          </div>

          <button
            onClick={() => router.push("/shopping")}
            className="flex items-center gap-2.5 px-3 py-3 hover:bg-muted/50 transition-colors relative"
          >
            <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center">
              <ShoppingCart className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-left">
              <p className="text-lg font-bold leading-none text-blue-700 dark:text-blue-400">
                {shoppingItemCount || "—"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">To buy</p>
            </div>
            <ChevronRight className="h-3 w-3 text-muted-foreground absolute right-1.5 top-1/2 -translate-y-1/2" />
          </button>
        </div>
      </div>

      {/* Main layout: day view + sidebar */}
      <div className="lg:grid lg:grid-cols-[1fr_272px] lg:gap-8 lg:items-start">
        {/* Selected day content */}
        <div>
          {/* Day heading */}
          <div className="flex items-center gap-3 mb-4">
            <h2 className={`text-lg font-bold ${isToday ? "text-orange-500" : ""}`}>
              {selectedDayLabel}
            </h2>
            {isToday && (
              <span className="text-xs font-semibold bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400 px-2 py-0.5 rounded-full">
                Today
              </span>
            )}
          </div>

          {/* Meal entries */}
          {selectedDayEntries.length > 0 ? (
            <ul className="space-y-3 mb-4">
              {selectedDayEntries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/20 py-10 flex flex-col items-center gap-2 mb-4 text-muted-foreground">
              <span className="text-3xl">🍽</span>
              <p className="text-sm">No meals planned for this day</p>
            </div>
          )}

          {/* Add meal button */}
          {recipes.length > 0 ? (
            <AddEntryDialog
              weekStartDate={weekStartDate}
              dayOfWeek={selectedDay}
              dayLabel={selectedDayLabel}
              recipes={recipes}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Add some recipes first to start planning meals.
            </p>
          )}
        </div>

        {/* Desktop sidebar */}
        <div className="hidden lg:flex flex-col gap-4 sticky top-8">
          {/* Pie chart */}
          <MealTypePieChart entries={entries} />

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
