"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ShoppingCart,
  Sparkles,
  Plus,
  Lightbulb,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  useSensors,
  useSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button, ToastAction } from "@dishes/ui";
import {
  generateShoppingFromWeek,
  moveMealEntry,
} from "@/app/actions/meal-plan";
import type { ShoppingAddResult } from "@/lib/services/meal-plan";
import { notifyShoppingChanged } from "@/components/providers/shopping-count-context";
import { useSync } from "@/components/providers/sync-provider";
import { useToast } from "@/hooks/use-toast";
import { AddEntryDialog } from "./add-entry-dialog";
import { DinnerTimeChip, useWeekDinnerSchedule } from "./dinner-time-chip";
import { EntryCard } from "./entry-card";
import { WeekNutritionPanel } from "./week-nutrition-card";
import { summariseMeals } from "@/lib/meal-stats";
import { suggestSwaps, type SwapSuggestion } from "@/lib/meal-swaps";

const NUTRITION_OPEN_KEY = "dishes:meal-plan:nutrition-open";

type MealType = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";
const MEAL_TYPE_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "dessert", "snack"];

const MEAL_TYPE_COLOR: Record<MealType, string> = {
  breakfast: "#f59e0b",
  lunch: "#8b5cf6",
  dinner: "#6366f1",
  dessert: "#ec4899",
  snack: "#94a3b8",
};

const OVERLAY_MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
};

export type Entry = {
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

export type Recipe = {
  id: string;
  title: string;
  cuisine: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  isFavourite: boolean;
  tags: string[];
  avgRating: number | null;
  ingredientNames: string[];
  // Per serving, for the weekly nutrition card. Optional so the picker and
  // other callers that don't care can leave them out.
  calories?: number | null;
  saturatedFatG?: string | null;
  fiberG?: string | null;
  /** Which slots the recipe suits; empty/missing = unknown. Used by swap suggestions. */
  mealTypes?: string[];
};

export type TopIngredient = {
  name: string;
  count: number;
};

/**
 * The entry edits that can be routed somewhere other than the server actions.
 * These are exactly the ones `POST /api/v1/sync` accepts as
 * `meal_plan_entry.update` / `.delete`.
 */
export type MealPlanMutations = {
  addEntry: (
    weekStartDate: string,
    recipeId: string,
    dayOfWeek: number,
    mealType: MealType
  ) => void;
  moveEntry: (entryId: string, dayOfWeek: number) => void;
  changeEntryType: (entryId: string, mealType: MealType) => void;
  updateEntryServings: (entryId: string, servings: number | null) => void;
  deleteEntry: (entryId: string) => void;
};

export interface WeekPlannerProps {
  weekStartDate: string;
  planId: string | null;
  entries: Entry[];
  recipes: Recipe[];
  isCurrentWeek: boolean;
  todayDayIndex: number;
  topIngredients: TopIngredient[];
  shoppingItemCount: number;
  /** Someone in the household is on a cholesterol-lowering diet: show the weekly targets. */
  heartFocus?: boolean;
  /**
   * How entry edits are persisted. Every field defaults to the matching server
   * action; `WeekPlannerLocal` supplies versions that go through the sync
   * engine instead. Optimistic UI updates are done by the components either
   * way.
   *
   * Only the edits the sync schema accepts are here. Generating a shopping
   * list stays on its server action — see the notes in
   * `week-planner-local.tsx`.
   */
  mutations?: MealPlanMutations;
  /**
   * How a week change is navigated. Defaults to `router.push`;
   * `WeekPlannerLocal` supplies a `history.pushState` version when the store
   * can serve the target week without the server. The exit/enter animation is
   * driven from here either way.
   */
  onNavigateWeek?: (weekStartDate: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMondayOf(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatDayChip(weekStart: string, dayIndex: number) {
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

// Module-level: persists across client-side navigations so the incoming page
// knows which direction to animate from.
let pendingEnterDirection: "from-left" | "from-right" | null = null;

// ─── Week Calendar Picker ─────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

function WeekCalendarPicker({
  weekStartDate,
  onSelect,
  onClose,
}: {
  weekStartDate: string;
  onSelect: (weekStart: string) => void;
  onClose: () => void;
}) {
  const initial = new Date(weekStartDate + "T00:00:00");
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const calRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const gridStart = getMondayOf(firstOfMonth);

  const weeks: { days: Date[]; weekStart: string }[] = [];
  const cur = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const days: Date[] = [];
    for (let d = 0; d < 7; d++) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push({ days, weekStart: toDateStr(days[0]) });
    if (days[6].getMonth() !== viewMonth && w >= 3) break;
  }

  return (
    <div
      ref={calRef}
      className="absolute left-0 top-full z-50 mt-2 w-72 rounded-xl border bg-popover shadow-xl p-3 animate-in fade-in slide-in-from-top-2 duration-150"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMonth}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-semibold text-sm">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          onClick={nextMonth}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map((d, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-semibold text-muted-foreground uppercase py-1"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="space-y-0.5">
        {weeks.map(({ days, weekStart }) => {
          const isSelected = weekStart === weekStartDate;
          return (
            <button
              key={weekStart}
              onClick={() => { onSelect(weekStart); onClose(); }}
              className={`grid grid-cols-7 w-full rounded-lg transition-all group ${
                isSelected
                  ? "bg-primary/10 hover:bg-primary/15"
                  : "hover:bg-muted/60"
              }`}
            >
              {days.map((day, di) => {
                const inMonth = day.getMonth() === viewMonth;
                const isToday = day.getTime() === today.getTime();
                return (
                  <div
                    key={di}
                    className={`text-center py-1.5 text-sm rounded-md ${
                      isToday
                        ? "text-orange-500 font-bold"
                        : isSelected
                          ? "font-semibold text-primary"
                          : inMonth
                            ? "font-medium"
                            : "text-muted-foreground/35"
                    }`}
                  >
                    {day.getDate()}
                  </div>
                );
              })}
            </button>
          );
        })}
      </div>

      <div className="mt-2 pt-2 border-t">
        <button
          onClick={() => {
            const monday = getMondayOf(new Date());
            onSelect(toDateStr(monday));
            onClose();
          }}
          className="w-full text-center text-xs font-medium text-orange-500 hover:text-orange-600 py-1 rounded hover:bg-orange-50 dark:hover:bg-orange-950/20 transition-colors"
        >
          Jump to this week
        </button>
      </div>
    </div>
  );
}

// ─── Droppable day chip ───────────────────────────────────────────────────────

function DroppableDayChip({
  dayIndex,
  weekStart,
  isCurrentWeek,
  todayDayIndex,
  isSelected,
  mealCount,
  isDragActive,
  hasSuggestion,
  onClick,
}: {
  dayIndex: number;
  weekStart: string;
  isCurrentWeek: boolean;
  todayDayIndex: number;
  isSelected: boolean;
  mealCount: number;
  isDragActive: boolean;
  hasSuggestion: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dayIndex}` });
  const { short, date } = formatDayChip(weekStart, dayIndex);
  const isTodayChip = isCurrentWeek && todayDayIndex === dayIndex;

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={`relative flex flex-col items-center rounded-xl py-2.5 border-2 transition-all duration-150 ${
        isOver
          ? "border-orange-400 bg-orange-100 dark:bg-orange-950/50 scale-[1.06] shadow-lg"
          : isDragActive
            ? "border-dashed border-muted-foreground/30 bg-muted/50 hover:border-muted-foreground/50 hover:bg-muted/70"
            : isSelected
              ? isTodayChip
                ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30 shadow-sm"
                : "border-primary bg-primary/5 shadow-sm"
              : isTodayChip
                ? "border-orange-300/60 bg-orange-50/50 dark:bg-orange-950/10"
                : "border-transparent bg-muted/40 hover:bg-muted"
      }`}
    >
      <span
        className={`text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide leading-none ${
          isOver
            ? "text-orange-500"
            : isSelected
              ? isTodayChip ? "text-orange-500" : "text-primary"
              : "text-muted-foreground"
        }`}
      >
        {short}
      </span>
      <span
        className={`text-lg sm:text-xl font-bold leading-none mt-1 ${
          isOver
            ? "text-orange-500"
            : isSelected
              ? isTodayChip ? "text-orange-500" : "text-primary"
              : isTodayChip ? "text-orange-400" : ""
        }`}
      >
        {date}
      </span>
      {hasSuggestion && (
        <span
          className="absolute right-1 top-1 h-2 w-2 rounded-full bg-gradient-to-br from-violet-500 to-orange-500 ring-2 ring-background"
          aria-label="Swap suggested"
        />
      )}
      {mealCount > 0 ? (
        <span
          className={`mt-1.5 text-[9px] font-bold tabular-nums leading-none h-3.5 min-w-[14px] rounded-full flex items-center justify-center px-1 ${
            isOver
              ? "bg-orange-400 text-white"
              : isTodayChip
                ? "bg-orange-400 text-white"
                : isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/20 text-primary"
          }`}
        >
          {mealCount}
        </span>
      ) : (
        <span className="mt-1.5 h-3.5" />
      )}
    </button>
  );
}

// ─── Draggable meal entry ─────────────────────────────────────────────────────

function DraggableMealEntry({
  entry,
  weekStartDate,
  mutations,
  suggestion,
  onShowSuggestion,
}: {
  entry: Entry;
  weekStartDate: string;
  mutations?: MealPlanMutations;
  suggestion?: SwapSuggestion;
  onShowSuggestion: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.id,
    data: { entry },
  });

  const card = (
    <EntryCard
      entry={entry}
      weekStartDate={weekStartDate}
      mutations={mutations}
      dragNodeRef={setNodeRef}
      dragListeners={listeners as Record<string, unknown>}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      isDragging={isDragging}
    />
  );
  if (!suggestion || isDragging) return card;

  // EntryCard is an <li>, so the nudge is a sibling <li> rather than a wrapper.
  return (
    <>
      {card}
      <li className="!mt-1.5 list-none">
      <button
        type="button"
        onClick={onShowSuggestion}
        className="flex w-full items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-50 to-orange-50 px-3 py-1.5 text-left text-xs text-violet-900 transition-colors hover:from-violet-100 hover:to-orange-100 dark:from-violet-950/30 dark:to-orange-950/20 dark:text-violet-200"
      >
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-orange-500" />
        <span className="min-w-0 flex-1 truncate">
          {suggestion.toRecipe ? (
            <>
              Try <span className="font-semibold">{suggestion.toRecipe.title}</span> instead — {suggestion.reason}
            </>
          ) : (
            <>Swap suggested — {suggestion.reason}</>
          )}
        </span>
        <span className="shrink-0 font-semibold text-orange-600 dark:text-orange-400">See →</span>
      </button>
      </li>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WeekPlanner({
  weekStartDate,
  planId,
  entries,
  recipes,
  isCurrentWeek,
  todayDayIndex,
  topIngredients,
  shoppingItemCount,
  heartFocus = false,
  mutations,
  onNavigateWeek,
}: WeekPlannerProps) {
  const router = useRouter();
  const { toast } = useToast();
  const contentRef = useRef<HTMLDivElement>(null);
  const isFirstMount = useRef(true);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const lastWheelMs = useRef(0);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [shoppingPending, startShoppingTransition] = useTransition();
  const sync = useSync();

  /**
   * `generateShoppingFromWeek` stamps `addedToShoppingListAt` on every entry it
   * covers, server-side. The cards read that from the local store, so without a
   * pull the whole week keeps showing as un-shopped until a refresh.
   */
  const refreshFromServer = useCallback(() => {
    void sync?.engine?.sync().catch(() => {});
  }, [sync]);
  const [, startMoveTransition] = useTransition();

  const [selectedDay, setSelectedDay] = useState<number>(() =>
    isCurrentWeek && todayDayIndex >= 0 ? todayDayIndex : 0
  );

  // Local entries for optimistic drag updates
  const [localEntries, setLocalEntries] = useState<Entry[]>(entries);
  const [activeDragEntry, setActiveDragEntry] = useState<Entry | null>(null);

  useEffect(() => {
    setLocalEntries(entries);
  }, [entries]);

  useEffect(() => {
    setSelectedDay(isCurrentWeek && todayDayIndex >= 0 ? todayDayIndex : 0);
  }, [weekStartDate, isCurrentWeek, todayDayIndex]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    const direction = pendingEnterDirection;
    pendingEnterDirection = null;

    if (!direction) {
      el.style.transition = "";
      el.style.transform = "";
      el.style.opacity = "";
      return;
    }

    const startX = direction === "from-right" ? 48 : -48;
    el.style.transition = "none";
    el.style.transform = `translateX(${startX}px)`;
    el.style.opacity = "0";

    let raf1 = 0, raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.style.transition = "transform 240ms cubic-bezier(0.25,0.46,0.45,0.94), opacity 200ms ease-out";
        el.style.transform = "translateX(0)";
        el.style.opacity = "1";
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      el.style.transition = "";
      el.style.transform = "";
      el.style.opacity = "";
    };
  }, [weekStartDate]);

  const prevWeek = addDays(weekStartDate, -7);
  const nextWeek = addDays(weekStartDate, 7);

  const navigate = useCallback((target: string, direction: "prev" | "next") => {
    if (exitTimeoutRef.current !== null) {
      clearTimeout(exitTimeoutRef.current);
      exitTimeoutRef.current = null;
    }

    const go = () => {
      if (onNavigateWeek) onNavigateWeek(target);
      else router.push(`/meal-plan?week=${target}`);
    };

    pendingEnterDirection = direction === "next" ? "from-right" : "from-left";
    const el = contentRef.current;
    const exitX = direction === "next" ? -48 : 48;
    if (el) {
      el.style.transition = "transform 200ms cubic-bezier(0.55,0,1,0.45), opacity 180ms ease-in";
      el.style.transform = `translateX(${exitX}px)`;
      el.style.opacity = "0";
      exitTimeoutRef.current = setTimeout(() => {
        exitTimeoutRef.current = null;
        go();
      }, 190);
    } else {
      go();
    }
  }, [router, onNavigateWeek]);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    // Don't navigate while a drag is in progress
    if (activeDragEntry) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      navigate(dx > 0 ? prevWeek : nextWeek, dx > 0 ? "prev" : "next");
    }
  }

  function handleWheel(e: React.WheelEvent) {
    if (Math.abs(e.deltaX) < 20 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    const now = Date.now();
    if (now - lastWheelMs.current < 900) return;
    lastWheelMs.current = now;
    navigate(e.deltaX > 0 ? nextWeek : prevWeek, e.deltaX > 0 ? "next" : "prev");
  }

  // DnD sensors
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const entry = localEntries.find((e) => e.id === event.active.id);
    setActiveDragEntry(entry ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragEntry(null);
    const { active, over } = event;
    if (!over) return;

    const entryId = active.id as string;
    const newDay = parseInt((over.id as string).replace("day-", ""), 10);
    const entry = localEntries.find((e) => e.id === entryId);
    if (!entry || entry.dayOfWeek === newDay) return;

    // Optimistic update + switch to the new day
    setLocalEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, dayOfWeek: newDay } : e))
    );
    setSelectedDay(newDay);

    if (mutations) mutations.moveEntry(entryId, newDay);
    else startMoveTransition(() => moveMealEntry(entryId, newDay));
  }

  const totalMeals = localEntries.length;
  const totalTime = localEntries.reduce(
    (sum, e) => sum + (e.recipe.prepTimeMinutes ?? 0) + (e.recipe.cookTimeMinutes ?? 0), 0
  );

  // Nutrition summary and swap suggestions, recomputed as entries move.
  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const nutritionSummary = useMemo(
    () =>
      summariseMeals(
        localEntries.map((e) => {
          const r = recipeById.get(e.recipe.id);
          return {
            recipeId: e.recipe.id,
            calories: r?.calories ?? null,
            saturatedFatG: r?.saturatedFatG ?? null,
            fiberG: r?.fiberG ?? null,
            ingredientNames: r?.ingredientNames ?? [],
          };
        })
      ),
    [localEntries, recipeById]
  );
  const suggestions = useMemo(
    () =>
      heartFocus
        ? suggestSwaps(
            localEntries.map((e) => ({
              id: e.id,
              dayOfWeek: e.dayOfWeek,
              mealType: e.mealType,
              recipeId: e.recipe.id,
            })),
            recipes,
            nutritionSummary.proteins
          )
        : [],
    [heartFocus, localEntries, recipes, nutritionSummary]
  );
  const suggestionByEntry = useMemo(
    () => new Map(suggestions.map((sg) => [sg.entryId, sg])),
    [suggestions]
  );

  // Collapsed by default; remembered per device.
  const [nutritionOpen, setNutritionOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(NUTRITION_OPEN_KEY) === "1") setNutritionOpen(true);
    } catch {}
  }, []);
  function changeNutritionOpen(open: boolean) {
    setNutritionOpen(open);
    try {
      localStorage.setItem(NUTRITION_OPEN_KEY, open ? "1" : "0");
    } catch {}
  }
  function showSuggestions() {
    changeNutritionOpen(true);
    requestAnimationFrame(() =>
      document.getElementById("week-nutrition")?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }

  const selectedDayEntries = localEntries
    .filter((e) => e.dayOfWeek === selectedDay)
    .sort((a, b) => MEAL_TYPE_ORDER.indexOf(a.mealType) - MEAL_TYPE_ORDER.indexOf(b.mealType));

  const selectedDayLabel = formatDayHeading(weekStartDate, selectedDay);
  const isToday = isCurrentWeek && todayDayIndex === selectedDay;

  const dinnerEntries = localEntries.filter((e) => e.mealType === "dinner");
  const { schedule: dinnerSchedule, updateDay: updateDinnerDay } = useWeekDinnerSchedule(
    weekStartDate,
    dinnerEntries.map((e) => e.recipe.id)
  );
  const selectedDinnerDay = dinnerSchedule?.days[selectedDay];

  // Report what actually reached the list. A week whose ingredients are all
  // covered by the pantry used to look identical to a successful generation.
  function reportShoppingResult(result: ShoppingAddResult) {
    const parts: string[] = [];
    if (result.added > 0) parts.push(`${result.added} added`);
    if (result.merged > 0) parts.push(`${result.merged} topped up`);
    if (result.skipped.length > 0) {
      parts.push(`${result.skipped.length} already in your pantry`);
    }

    const landed = result.added + result.merged > 0;
    toast({
      title: landed ? "Shopping list updated" : "Nothing added — it's all in your pantry",
      description: parts.join(" · ") || "This week's meals have no ingredients.",
      action:
        result.skipped.length > 0 ? (
          <ToastAction
            altText="Add the pantry-covered ingredients anyway"
            onClick={() => handleForceShopping(result.skipped)}
          >
            Add anyway
          </ToastAction>
        ) : undefined,
    });
  }

  function handleGenerateShopping() {
    if (!planId) return;
    startShoppingTransition(async () => {
      const result = await generateShoppingFromWeek(planId);
      notifyShoppingChanged();
      refreshFromServer();
      reportShoppingResult(result);
    });
  }

  function handleForceShopping(names: string[]) {
    if (!planId) return;
    startShoppingTransition(async () => {
      const result = await generateShoppingFromWeek(planId, { forceInclude: names });
      notifyShoppingChanged();
      refreshFromServer();
      toast({
        title: "Added to shopping list",
        description: `${result.added + result.merged} pantry ingredient${
          result.added + result.merged === 1 ? "" : "s"
        } added anyway`,
      });
    });
  }

  // Meals not yet pushed to the shopping list — generation only adds these
  const pendingShoppingCount = localEntries.filter((e) => !e.addedToShoppingListAt).length;

  const weekTitle = isCurrentWeek ? "This Week" : formatWeekRange(weekStartDate);

  return (
    <div
      className="p-4 lg:p-8 overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div ref={contentRef}>
          {/* ── Header row ── */}
          <div className="flex items-center gap-1 mb-1">
            <button
              onClick={() => navigate(prevWeek, "prev")}
              className="flex-shrink-0 p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Previous week"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="relative flex-1 min-w-0">
              <button
                onClick={() => setCalendarOpen((v) => !v)}
                className="flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-muted transition-colors group"
              >
                <h1 className="text-xl font-bold leading-tight truncate">{weekTitle}</h1>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200 ${
                    calendarOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {calendarOpen && (
                <WeekCalendarPicker
                  weekStartDate={weekStartDate}
                  onSelect={(ws) => navigate(ws, ws > weekStartDate ? "next" : "prev")}
                  onClose={() => setCalendarOpen(false)}
                />
              )}
            </div>

            <button
              onClick={() => navigate(nextWeek, "next")}
              className="flex-shrink-0 p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Next week"
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            {recipes.length > 0 && (
              <AddEntryDialog
                weekStartDate={weekStartDate}
                dayOfWeek={selectedDay}
                dayLabel={selectedDayLabel}
                recipes={recipes}
                onAdd={mutations?.addEntry}
                trigger={
                  <button
                    className="flex-shrink-0 h-9 w-9 rounded-full bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center shadow-md transition-colors ml-1"
                    aria-label="Add meal"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                }
              />
            )}
          </div>

          <p className="text-sm text-muted-foreground mb-5 pl-9">
            {[
              isCurrentWeek ? formatWeekRange(weekStartDate) : null,
              totalMeals > 0 ? `${totalMeals} meal${totalMeals === 1 ? "" : "s"}` : null,
              totalTime > 0 ? `${formatTotalTime(totalTime)} cooking` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {/* ── Day strip — droppable chips ── */}
          <div className="grid grid-cols-7 gap-1.5 mb-5">
            {Array.from({ length: 7 }, (_, i) => {
              const mealCount = localEntries.filter((e) => e.dayOfWeek === i).length;
              return (
                <DroppableDayChip
                  key={`${weekStartDate}-${i}`}
                  dayIndex={i}
                  weekStart={weekStartDate}
                  isCurrentWeek={isCurrentWeek}
                  todayDayIndex={todayDayIndex}
                  isSelected={selectedDay === i}
                  mealCount={mealCount}
                  isDragActive={activeDragEntry !== null}
                  hasSuggestion={suggestions.some((sg) => sg.dayOfWeek === i)}
                  onClick={() => setSelectedDay(i)}
                />
              );
            })}
          </div>

          {/* ── Actions ── */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <Button
              className="h-auto py-3 justify-center gap-2 bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 border-0 text-white shadow-md"
              onClick={() => router.push("/ai-concierge?tab=plan")}
            >
              <Sparkles className="h-4 w-4" />
              Generate plan
            </Button>

            {totalMeals > 0 && planId && pendingShoppingCount > 0 ? (
              <Button
                className="h-auto py-3 justify-center gap-2 bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-700 hover:to-sky-600 border-0 text-white shadow-md"
                onClick={handleGenerateShopping}
                disabled={shoppingPending}
              >
                <ShoppingCart className="h-4 w-4" />
                {shoppingPending
                  ? "Adding…"
                  : `Add ${pendingShoppingCount} meal${pendingShoppingCount === 1 ? "" : "s"} to list`}
              </Button>
            ) : (
              <Button
                className="h-auto py-3 justify-center gap-2 bg-blue-50 dark:bg-blue-950/40 bg-gradient-to-br from-blue-500/15 to-sky-500/10 hover:from-blue-500/25 hover:to-sky-500/20 border border-blue-300/60 dark:border-blue-800/60 text-blue-800 dark:text-blue-200 shadow-sm"
                onClick={() => router.push("/shopping")}
              >
                <ShoppingCart className="h-4 w-4" />
                {shoppingItemCount > 0 ? `${shoppingItemCount} to buy` : "Shopping list"}
                <ChevronRight className="h-4 w-4 opacity-60" />
              </Button>
            )}
          </div>

          <WeekNutritionPanel
            summary={nutritionSummary}
            heartFocus={heartFocus}
            suggestions={suggestions}
            topIngredients={topIngredients}
            open={nutritionOpen}
            onOpenChange={changeNutritionOpen}
            weekStartDate={weekStartDate}
            mutations={mutations}
            onSelectDay={setSelectedDay}
          />

          {/* ── Selected day ── */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <h2 className={`text-lg font-bold ${isToday ? "text-orange-500" : ""}`}>
                {selectedDayLabel}
              </h2>
              {isToday && (
                <span className="text-xs font-semibold bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400 px-2 py-0.5 rounded-full">
                  Today
                </span>
              )}
              {selectedDinnerDay && dinnerSchedule && (
                <DinnerTimeChip
                  date={addDays(weekStartDate, selectedDay)}
                  dayLabel={selectedDayLabel}
                  day={selectedDinnerDay}
                  dishes={dinnerEntries
                    .filter((e) => e.dayOfWeek === selectedDay)
                    .map((e) => ({
                      recipeId: e.recipe.id,
                      title: e.recipe.title,
                      prepTimeMinutes: e.recipe.prepTimeMinutes,
                      cookTimeMinutes: e.recipe.cookTimeMinutes,
                    }))}
                  estimates={dinnerSchedule.estimates}
                  onChange={updateDinnerDay}
                />
              )}
            </div>

            {selectedDayEntries.length > 0 ? (
              <ul className="space-y-3 mb-4">
                {selectedDayEntries.map((entry) => (
                  <DraggableMealEntry
                    key={entry.id}
                    entry={entry}
                    weekStartDate={weekStartDate}
                    mutations={mutations}
                    suggestion={suggestionByEntry.get(entry.id)}
                    onShowSuggestion={showSuggestions}
                  />
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-dashed bg-muted/20 py-10 flex flex-col items-center gap-2 mb-4 text-muted-foreground">
                <span className="text-3xl">🍽</span>
                <p className="text-sm">No meals planned for this day</p>
                {recipes.length === 0 && (
                  <p className="text-xs mt-1">Add some recipes first to start planning meals.</p>
                )}
              </div>
            )}

            {recipes.length > 0 && (
              <AddEntryDialog
                weekStartDate={weekStartDate}
                dayOfWeek={selectedDay}
                dayLabel={selectedDayLabel}
                recipes={recipes}
                onAdd={mutations?.addEntry}
              />
            )}
          </div>
        </div>

        {/* Drag overlay — floating card shown while dragging */}
        <DragOverlay dropAnimation={null}>
          {activeDragEntry ? (
            <div className="rounded-xl border-2 border-orange-400 bg-card shadow-2xl px-4 py-3 flex items-center gap-3 w-72 cursor-grabbing rotate-1">
              <span
                className="flex-shrink-0 h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: MEAL_TYPE_COLOR[activeDragEntry.mealType] }}
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">
                  {OVERLAY_MEAL_LABEL[activeDragEntry.mealType]}
                </p>
                <p className="font-bold text-sm leading-snug line-clamp-1">
                  {activeDragEntry.recipe.title}
                </p>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
