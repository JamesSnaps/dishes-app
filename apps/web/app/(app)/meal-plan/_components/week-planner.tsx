"use client";

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ShoppingCart,
  UtensilsCrossed,
  Sparkles,
  ShoppingBag,
  Bell,
  Users,
  Clock,
  Plus,
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
import { Button } from "@dishes/ui";
import { generateShoppingFromWeek, moveMealEntry } from "@/app/actions/meal-plan";
import { notifyShoppingChanged } from "@/components/providers/shopping-count-context";
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

const OVERLAY_MEAL_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
};

type Entry = {
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

type Recipe = {
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

// ─── Donut chart ──────────────────────────────────────────────────────────────

function MealTypePieChart({ entries }: { entries: Entry[] }) {
  const counts: Partial<Record<MealType, number>> = {};
  for (const e of entries) counts[e.mealType] = (counts[e.mealType] ?? 0) + 1;

  const types = Object.entries(counts) as [MealType, number][];
  const total = entries.length;
  if (total === 0) return null;

  const SIZE = 140;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = 52;
  const innerR = 32;
  const strokeW = r - innerR;
  const midR = innerR + strokeW / 2;

  const MEAL_LABELS: Record<MealType, string> = {
    breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner",
    dessert: "Dessert", snack: "Snacks",
  };

  let cumAngle = -Math.PI / 2;
  const slices = types.map(([type, count]) => {
    const angle = (count / total) * 2 * Math.PI;
    const start = cumAngle;
    cumAngle += angle;
    return { type, count, start, end: cumAngle };
  });

  function polarToXY(angle: number, radius: number) {
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  }

  function slicePath(start: number, end: number) {
    const s1 = polarToXY(start, r);
    const e1 = polarToXY(end, r);
    const s2 = polarToXY(end, innerR);
    const e2 = polarToXY(start, innerR);
    const large = end - start > Math.PI ? 1 : 0;
    return [
      `M ${s1.x} ${s1.y}`, `A ${r} ${r} 0 ${large} 1 ${e1.x} ${e1.y}`,
      `L ${s2.x} ${s2.y}`, `A ${innerR} ${innerR} 0 ${large} 0 ${e2.x} ${e2.y}`, "Z",
    ].join(" ");
  }

  return (
    <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-900/60 dark:to-slate-800/40 p-4 border border-slate-200/60 dark:border-slate-700/40">
      <h3 className="font-semibold text-sm mb-4">Week Overview</h3>
      <div className="flex flex-col items-center gap-4">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="drop-shadow-sm">
          {slices.length === 1 ? (
            <circle cx={cx} cy={cy} r={midR} fill="none" stroke={MEAL_TYPE_COLOR[slices[0].type]} strokeWidth={strokeW} opacity={0.9} />
          ) : (
            slices.map(({ type, start, end }) => (
              <path key={type} d={slicePath(start, end)} fill={MEAL_TYPE_COLOR[type]} opacity={0.9} />
            ))
          )}
          <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="middle" fontSize="18" fontWeight="700" className="fill-foreground">{total}</text>
          <text x={cx} y={cy + 12} textAnchor="middle" dominantBaseline="middle" fontSize="9" className="fill-muted-foreground">meals</text>
        </svg>
        <div className="w-full flex flex-col gap-2">
          {slices.map(({ type, count }) => (
            <div key={type} className="flex items-center gap-2.5">
              <span className="flex-shrink-0 h-2.5 w-2.5 rounded-full shadow-sm" style={{ backgroundColor: MEAL_TYPE_COLOR[type] }} />
              <span className="text-sm text-muted-foreground flex-1">{MEAL_LABELS[type]}</span>
              <span className="text-sm font-bold tabular-nums">{count}</span>
            </div>
          ))}
        </div>
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
  onClick,
}: {
  dayIndex: number;
  weekStart: string;
  isCurrentWeek: boolean;
  todayDayIndex: number;
  isSelected: boolean;
  mealCount: number;
  isDragActive: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${dayIndex}` });
  const { short, date } = formatDayChip(weekStart, dayIndex);
  const isTodayChip = isCurrentWeek && todayDayIndex === dayIndex;

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={`flex flex-col items-center rounded-xl py-2.5 border-2 transition-all duration-150 ${
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

function DraggableMealEntry({ entry, weekStartDate }: { entry: Entry; weekStartDate: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.id,
    data: { entry },
  });

  return (
    <EntryCard
      entry={entry}
      weekStartDate={weekStartDate}
      dragNodeRef={setNodeRef}
      dragListeners={listeners as Record<string, unknown>}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      isDragging={isDragging}
    />
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
}: Props) {
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const isFirstMount = useRef(true);
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const lastWheelMs = useRef(0);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [shoppingPending, startShoppingTransition] = useTransition();
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

    pendingEnterDirection = direction === "next" ? "from-right" : "from-left";
    const el = contentRef.current;
    const exitX = direction === "next" ? -48 : 48;
    if (el) {
      el.style.transition = "transform 200ms cubic-bezier(0.55,0,1,0.45), opacity 180ms ease-in";
      el.style.transform = `translateX(${exitX}px)`;
      el.style.opacity = "0";
      exitTimeoutRef.current = setTimeout(() => {
        exitTimeoutRef.current = null;
        router.push(`/meal-plan?week=${target}`);
      }, 190);
    } else {
      router.push(`/meal-plan?week=${target}`);
    }
  }, [router]);

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

    startMoveTransition(() => moveMealEntry(entryId, newDay));
  }

  const totalMeals = localEntries.length;
  const totalTime = localEntries.reduce(
    (sum, e) => sum + (e.recipe.prepTimeMinutes ?? 0) + (e.recipe.cookTimeMinutes ?? 0), 0
  );
  const totalServings = localEntries.reduce((sum, e) => {
    const s = parseInt(e.recipe.servings ?? "0", 10);
    return sum + (isNaN(s) ? 0 : s);
  }, 0);
  const avgServings = totalMeals > 0 ? Math.round(totalServings / totalMeals) : 0;

  const selectedDayEntries = localEntries
    .filter((e) => e.dayOfWeek === selectedDay)
    .sort((a, b) => MEAL_TYPE_ORDER.indexOf(a.mealType) - MEAL_TYPE_ORDER.indexOf(b.mealType));

  const selectedDayLabel = formatDayHeading(weekStartDate, selectedDay);
  const isToday = isCurrentWeek && todayDayIndex === selectedDay;

  function handleGenerateShopping() {
    if (!planId) return;
    startShoppingTransition(async () => {
      await generateShoppingFromWeek(planId);
      notifyShoppingChanged();
    });
  }

  // Meals not yet pushed to the shopping list — generation only adds these
  const pendingShoppingCount = localEntries.filter((e) => !e.addedToShoppingListAt).length;
  const shoppingButtonLabel = shoppingPending
    ? "Adding to list…"
    : pendingShoppingCount === 0
      ? "All meals on list"
      : "Generate shopping list";

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
            {isCurrentWeek ? formatWeekRange(weekStartDate) : ""}
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
                  onClick={() => setSelectedDay(i)}
                />
              );
            })}
          </div>

          {/* ── Stats bar ── */}
          <div className="grid grid-cols-4 gap-2 mb-6">
            <div className="rounded-xl bg-gradient-to-br from-violet-500/10 to-violet-600/5 dark:from-violet-500/20 dark:to-violet-600/10 px-2 sm:px-3 py-3 sm:py-4 flex flex-col gap-2">
              <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-violet-500/15 dark:bg-violet-500/25 flex items-center justify-center">
                <Bell className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold leading-none text-violet-700 dark:text-violet-300">{totalMeals || "—"}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Meals</p>
              </div>
            </div>

            <div className="rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 dark:from-emerald-500/20 dark:to-emerald-600/10 px-2 sm:px-3 py-3 sm:py-4 flex flex-col gap-2">
              <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-emerald-500/15 dark:bg-emerald-500/25 flex items-center justify-center">
                <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold leading-none text-emerald-700 dark:text-emerald-300">{avgServings || "—"}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Avg serves</p>
              </div>
            </div>

            <div className="rounded-xl bg-gradient-to-br from-orange-500/10 to-orange-600/5 dark:from-orange-500/20 dark:to-orange-600/10 px-2 sm:px-3 py-3 sm:py-4 flex flex-col gap-2">
              <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-orange-500/15 dark:bg-orange-500/25 flex items-center justify-center">
                <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold leading-none text-orange-700 dark:text-orange-300">
                  {totalTime > 0 ? formatTotalTime(totalTime) : "—"}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">Cook time</p>
              </div>
            </div>

            <button
              onClick={() => router.push("/shopping")}
              className="rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 dark:from-blue-500/20 dark:to-blue-600/10 hover:from-blue-500/20 hover:to-blue-600/10 dark:hover:from-blue-500/30 transition-all px-2 sm:px-3 py-3 sm:py-4 flex flex-col gap-2 text-left relative"
            >
              <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-blue-500/15 dark:bg-blue-500/25 flex items-center justify-center">
                <ShoppingCart className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xl sm:text-2xl font-bold leading-none text-blue-700 dark:text-blue-300">{shoppingItemCount || "—"}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">To buy</p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-blue-400 absolute right-2 top-1/2 -translate-y-1/2" />
            </button>
          </div>

          {/* ── Main layout ── */}
          <div className="lg:grid lg:grid-cols-[1fr_272px] lg:gap-8 lg:items-start">
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
              </div>

              {selectedDayEntries.length > 0 ? (
                <ul className="space-y-3 mb-4">
                  {selectedDayEntries.map((entry) => (
                    <DraggableMealEntry
                      key={entry.id}
                      entry={entry}
                      weekStartDate={weekStartDate}
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
                />
              )}
            </div>

            {/* Desktop sidebar */}
            <div className="hidden lg:flex flex-col gap-4 sticky top-8">
              <MealTypePieChart entries={localEntries} />

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
                      disabled={shoppingPending || pendingShoppingCount === 0}
                    >
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      {shoppingButtonLabel}
                    </Button>
                  ) : (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground pt-1">
                      <UtensilsCrossed className="h-4 w-4 mt-0.5 shrink-0" />
                      <p>Add meals to generate a shopping list.</p>
                    </div>
                  )}
                </div>
              </div>

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
                disabled={shoppingPending || pendingShoppingCount === 0}
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                {shoppingButtonLabel}
              </Button>
            </div>
          )}
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
