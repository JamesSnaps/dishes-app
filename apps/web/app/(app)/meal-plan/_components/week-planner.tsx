"use client";

import { Fragment, useState, useEffect, useRef, useCallback, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ShoppingCart,
  Sparkles,
  Plus,
  Lightbulb,
  Truck,
  Plane,
  Heart,
  AlertTriangle,
  Check,
  UtensilsCrossed,
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
import {
  ToastAction,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Badge,
  Plate,
  SectionLabel,
} from "@dishes/ui";
import {
  generateShoppingFromWeek,
  moveMealEntry,
} from "@/app/actions/meal-plan";
import type {
  AddGroupInput,
  ShoppingAddResult,
  UpdateGroupInput,
} from "@/lib/services/meal-plan";
import type { SavedMeal } from "@/lib/services/meals";
import type { MealRole } from "@dishes/shared";
import { notifyShoppingChanged } from "@/components/providers/shopping-count-context";
import { useSync } from "@/components/providers/sync-provider";
import { useToast } from "@/hooks/use-toast";
import { AddEntryDialog } from "./add-entry-dialog";
import { DinnerTimeChip, useWeekDinnerSchedule } from "./dinner-time-chip";
import { DeliveryChip, useWeekDeliveries } from "./delivery-chip";
import { NextDeliveryCard } from "@/components/deliveries/next-delivery-card";
import { EntryCard } from "./entry-card";
import { MealGroupCard } from "./meal-group-card";
import { CombineMealDialog } from "./combine-meal-dialog";
import { BuildMealDialog } from "./build-meal-dialog";
import { defaultSelection, needsChoices, selectionToComponents } from "@/lib/saved-meals";
import { usePlanWriter } from "./plan-writer";
import { WeekNutritionPanel } from "./week-nutrition-card";
import { summariseMeals, meetsTarget, WEEKLY_PROTEIN_TARGETS, type ProteinKind } from "@/lib/meal-stats";
import { suggestSwaps, type SwapSuggestion } from "@/lib/meal-swaps";
import { countsAsMeal, outsideMealFacts, outsideMealLabel, type OutsideMealView } from "@/lib/outside-meals";
import { OUTSIDE_MEAL_KIND_LABELS } from "@dishes/shared";
import { OutsideMealSheet, localToday } from "@/components/outside-meals/outside-meal-sheet";
import type { ReviewMember } from "@/components/cook-review/cook-review-form";
import { OutsideMealCard } from "./outside-meal-card";
import {
  DayRow,
  SLOT_LABEL,
  WeekGlance,
  WeekGrid,
  usePlannerLayout,
  type DaySummary,
  type MealSlot,
  type SlotItem,
} from "./planner-layouts";


type MealType = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";
const MEAL_TYPE_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "dessert", "snack"];

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
  /** The combined meal this recipe is part of, if any. */
  groupId: string | null;
  mealRole: MealRole | null;
  /** Its place in the day as arranged (the iOS app reorders); 0 until then. */
  position?: number;
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
  mealRole?: MealRole | null;
  /** Which slots the recipe suits; empty/missing = unknown. Used by swap suggestions. */
  mealTypes?: string[];
};

/** A combined meal on the plan — several entries cooked and served together. */
export type PlannedGroup = {
  id: string;
  title: string;
  dayOfWeek: number;
  mealType: MealType;
  sourceMealId: string | null;
  /** Its place in the day as arranged (the iOS app reorders); 0 until then. */
  position?: number;
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
    mealType: MealType,
    opts?: { groupId?: string; mealRole?: MealRole }
  ) => void;
  /** `weekStartDate` moves the entry into that week; omit it to stay in this one. */
  moveEntry: (entryId: string, dayOfWeek: number, weekStartDate?: string) => void;
  changeEntryType: (entryId: string, mealType: MealType) => void;
  updateEntryServings: (entryId: string, servings: number | null) => void;
  deleteEntry: (entryId: string) => void;
  replaceEntryRecipe: (entryId: string, recipeId: string) => void;
  setEntryGroup: (entryId: string, groupId: string | null, mealRole?: MealRole) => void;
  addGroup: (input: AddGroupInput) => void;
  updateGroup: (groupId: string, input: UpdateGroupInput) => void;
  deleteGroup: (groupId: string, keepRecipes: boolean) => void;
};

export interface WeekPlannerProps {
  weekStartDate: string;
  planId: string | null;
  entries: Entry[];
  groups: PlannedGroup[];
  recipes: Recipe[];
  /** The household's saved meals, for the picker's Meals tab. */
  savedMeals: SavedMeal[];
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
  /** This week's meals not cooked from the plan — eaten out, takeaways, skipped. */
  outsideMeals?: OutsideMealView[];
  /** Who can be picked as eating, and whether photos can be stored. */
  people?: { members: ReviewMember[]; ownName: string | null; storageAvailable: boolean };
  /** An outside meal was saved or removed: re-read wherever they come from. */
  onOutsideMealsChanged?: () => void;
}

/** 0=Mon … 6=Sun for a date in the week starting `weekStart`; -1 outside it. */
function dayInWeek(weekStart: string, date: string): number {
  const day = Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(weekStart + "T00:00:00Z")) / 86_400_000);
  return day >= 0 && day < 7 ? day : -1;
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

/** "Sat 1 – Sun 9 Nov" for a holiday, the month only once when it's shared. */
function formatAwayRange(from: string, to: string): string {
  const fmt = (date: string, month: boolean) =>
    new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      ...(month ? { month: "short" } : {}),
    });
  if (from === to) return fmt(from, true);
  return `${fmt(from, from.slice(0, 7) !== to.slice(0, 7))} – ${fmt(to, true)}`;
}

/** Checklist lines still to do for the next order — as the iOS app's NextDeliveryCard.toDo. */
function deliveryToDo(next: {
  unplannedCount: number;
  mealsNotOnList: number;
  unticked: number;
  addedSinceOrder: string[];
  belowMinimum?: string | null;
}): number {
  return [
    next.unplannedCount > 0,
    next.mealsNotOnList > 0,
    next.unticked > 0,
    next.addedSinceOrder.length > 0,
    !!next.belowMinimum,
  ].filter(Boolean).length;
}

// Module-level: persists across client-side navigations so the incoming page
// knows which direction to animate from.
let pendingEnterDirection: "from-left" | "from-right" | null = null;

// Same idea for the day: after following a meal into another week ("View" on
// the moved toast), open that week on the day it landed rather than Monday.
let pendingSelectDay: number | null = null;

function takePendingSelectDay(): number | null {
  const day = pendingSelectDay;
  pendingSelectDay = null;
  return day;
}

function formatShortDate(weekStart: string, dayIndex: number): string {
  const d = new Date(weekStart + "T00:00:00");
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

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
                        ? "text-primary font-bold"
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
          className="w-full text-center text-xs font-medium text-primary hover:text-primary py-1 rounded hover:bg-highlight transition-colors"
        >
          Jump to this week
        </button>
      </div>
    </div>
  );
}

// ─── Droppable day chip ───────────────────────────────────────────────────────

// ─── Droppable week arrow ─────────────────────────────────────────────────────

/**
 * The prev/next week chevrons double as drop targets while a meal is being
 * dragged: dropping on "next" lands it on the following Monday, on "prev" on
 * the previous Sunday — the days either side of this week's edges. The target
 * date is spelled out during the drag so it's never a guess.
 */
function DroppableWeekArrow({
  direction,
  targetLabel,
  isDragActive,
  onClick,
}: {
  direction: "prev" | "next";
  targetLabel: string;
  isDragActive: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `week-${direction}` });
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;

  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={`flex-shrink-0 flex items-center gap-0.5 rounded-lg transition-all duration-150 ${
        isOver
          ? "p-1.5 border-2 border-transparent bg-highlight text-primary scale-[1.06] shadow-lg"
          : isDragActive
            ? "p-1.5 border-2 border-dashed border-transparent bg-highlight text-primary"
            : "p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground"
      }`}
      aria-label={direction === "prev" ? "Previous week" : "Next week"}
    >
      {direction === "next" && isDragActive && (
        <span className="text-xs font-semibold whitespace-nowrap pl-1">{targetLabel}</span>
      )}
      <Icon className="h-5 w-5" />
      {direction === "prev" && isDragActive && (
        <span className="text-xs font-semibold whitespace-nowrap pr-1">{targetLabel}</span>
      )}
    </button>
  );
}

// ─── Draggable meal entry ─────────────────────────────────────────────────────

function DraggableMealEntry({
  entry,
  weekStartDate,
  mutations,
  onMove,
  suggestion,
  onShowSuggestion,
  onMakeMeal,
  joinableGroups,
  onJoinGroup,
}: {
  entry: Entry;
  weekStartDate: string;
  mutations?: MealPlanMutations;
  onMove: (entryId: string, dayOfWeek: number, weekStartDate?: string) => void;
  suggestion?: SwapSuggestion;
  onShowSuggestion: () => void;
  onMakeMeal?: () => void;
  joinableGroups?: { id: string; title: string }[];
  onJoinGroup?: (groupId: string) => void;
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
      onMove={onMove}
      dragNodeRef={setNodeRef}
      dragListeners={listeners as Record<string, unknown>}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      isDragging={isDragging}
      onMakeMeal={onMakeMeal}
      joinableGroups={joinableGroups}
      onJoinGroup={onJoinGroup}
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
        className="flex w-full items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-left text-xs text-foreground transition-colors"
      >
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">
          {suggestion.toRecipe ? (
            <>
              Try <span className="font-semibold">{suggestion.toRecipe.title}</span> instead — {suggestion.reason}
            </>
          ) : (
            <>Swap suggested — {suggestion.reason}</>
          )}
        </span>
        <span className="shrink-0 font-semibold text-primary">See →</span>
      </button>
      </li>
    </>
  );
}

// ─── Draggable combined meal ──────────────────────────────────────────────────

function DraggableMealGroup(
  props: Omit<
    React.ComponentProps<typeof MealGroupCard>,
    "dragNodeRef" | "dragListeners" | "dragAttributes" | "isDragging"
  >
) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `group:${props.group.id}`,
  });
  return (
    <MealGroupCard
      {...props}
      dragNodeRef={setNodeRef}
      dragListeners={listeners as Record<string, unknown>}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      isDragging={isDragging}
    />
  );
}

/** What the selected day shows: a separate dish, or a combined meal of several. */
type DayItem =
  | { kind: "entry"; entry: Entry; mealType: MealType }
  | { kind: "group"; group: PlannedGroup; entries: Entry[]; mealType: MealType };

/**
 * Entries whose group is present and in the same slot render inside it;
 * anything else (group not synced yet, or the slots have drifted apart) falls
 * back to a separate card, so a dish is never hidden.
 */
function groupEntries(entries: Entry[], groups: PlannedGroup[]) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const members = new Map<string, Entry[]>();
  const loose: Entry[] = [];

  for (const e of entries) {
    const g = e.groupId ? byId.get(e.groupId) : undefined;
    if (g && g.dayOfWeek === e.dayOfWeek && g.mealType === e.mealType) {
      const list = members.get(g.id) ?? [];
      list.push(e);
      members.set(g.id, list);
    } else {
      loose.push(e);
    }
  }

  const items: DayItem[] = [
    ...loose.map((entry) => ({ kind: "entry" as const, entry, mealType: entry.mealType })),
    ...groups
      .filter((g) => members.has(g.id))
      .map((group) => ({
        kind: "group" as const,
        group,
        entries: members.get(group.id)!,
        mealType: group.mealType,
      })),
  ];
  return items;
}

function itemPosition(item: DayItem): number {
  return (item.kind === "group" ? item.group.position : item.entry.position) ?? 0;
}

function itemDay(item: DayItem): number {
  return item.kind === "entry" ? item.entry.dayOfWeek : item.group.dayOfWeek;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WeekPlanner({
  weekStartDate,
  planId,
  entries,
  groups,
  recipes,
  savedMeals,
  isCurrentWeek,
  todayDayIndex,
  topIngredients,
  shoppingItemCount,
  heartFocus = false,
  mutations,
  onNavigateWeek,
  outsideMeals = [],
  people,
  onOutsideMealsChanged,
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
  const rootRef = useRef<HTMLDivElement>(null);
  const layout = usePlannerLayout(rootRef);
  // The slot the add dialog opens on, from the week grid's "+".
  const [addSlot, setAddSlot] = useState<MealType | undefined>(undefined);
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

  const [selectedDay, setSelectedDay] = useState<number>(
    () => takePendingSelectDay() ?? (isCurrentWeek && todayDayIndex >= 0 ? todayDayIndex : 0)
  );

  // Local entries for optimistic drag updates
  const [localEntries, setLocalEntries] = useState<Entry[]>(entries);
  const [localGroups, setLocalGroups] = useState<PlannedGroup[]>(groups);
  // This week's outside meals, updated in place after a save until the
  // store (or a server refresh) catches up.
  const [localOutside, setLocalOutside] = useState<OutsideMealView[]>(outsideMeals);
  const [outsideSheet, setOutsideSheet] = useState<{
    meal: OutsideMealView | null;
    date: string;
    mealType: MealType;
  } | null>(null);
  const [activeDragEntry, setActiveDragEntry] = useState<Entry | null>(null);
  const [activeDragGroup, setActiveDragGroup] = useState<{
    group: PlannedGroup;
    count: number;
  } | null>(null);
  const writer = usePlanWriter(mutations);
  const [combineFrom, setCombineFrom] = useState<Entry | null>(null);
  const [building, setBuilding] = useState<{
    meal: SavedMeal;
    mealType: MealType;
    dayOfWeek: number;
  } | null>(null);

  useEffect(() => {
    setLocalEntries(entries);
  }, [entries]);

  useEffect(() => {
    setLocalGroups(groups);
  }, [groups]);

  useEffect(() => {
    setLocalOutside(outsideMeals);
  }, [outsideMeals]);

  useEffect(() => {
    setSelectedDay(
      takePendingSelectDay() ?? (isCurrentWeek && todayDayIndex >= 0 ? todayDayIndex : 0)
    );
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
    if (activeDragEntry || activeDragGroup) return;
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
    const id = String(event.active.id);
    if (id.startsWith("group:")) {
      const group = localGroups.find((g) => `group:${g.id}` === id);
      setActiveDragGroup(
        group
          ? { group, count: localEntries.filter((e) => e.groupId === group.id).length }
          : null
      );
      return;
    }
    const entry = localEntries.find((e) => e.id === id);
    setActiveDragEntry(entry ?? null);
  }

  /**
   * Every move goes through here — drag-and-drop and the card's "Move to…"
   * menu alike — so the optimistic update and the cross-week toast are the
   * same whichever way the user did it. `targetWeek` other than this one moves
   * the meal out of view, so the toast offers to follow it there.
   */
  function moveEntry(entryId: string, newDay: number, targetWeek?: string) {
    const entry = localEntries.find((e) => e.id === entryId);
    if (!entry) return;

    const crossWeek = targetWeek !== undefined && targetWeek !== weekStartDate;
    if (!crossWeek && entry.dayOfWeek === newDay) return;

    setLocalEntries((prev) =>
      crossWeek
        ? prev.filter((e) => e.id !== entryId)
        : // A dish moved out of its combined meal leaves it (the server does the same).
          prev.map((e) =>
            e.id === entryId ? { ...e, dayOfWeek: newDay, groupId: null, mealRole: null } : e
          )
    );

    const week = crossWeek ? targetWeek : undefined;
    if (mutations) mutations.moveEntry(entryId, newDay, week);
    else startMoveTransition(() => moveMealEntry(entryId, newDay, week));

    if (crossWeek) {
      toast({
        title: `Moved to ${formatShortDate(targetWeek, newDay)}`,
        description: entry.recipe.title,
        action: (
          <ToastAction
            altText="Go to that week"
            onClick={() => {
              pendingSelectDay = newDay;
              navigate(targetWeek, targetWeek > weekStartDate ? "next" : "prev");
            }}
          >
            View
          </ToastAction>
        ),
      });
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragEntry(null);
    setActiveDragGroup(null);
    const { active, over } = event;
    if (!over) return;

    const entryId = active.id as string;
    const overId = over.id as string;

    // A whole combined meal: the group and every dish in it move together.
    // Within the week only — the week-edge drop targets take single dishes.
    if (entryId.startsWith("group:")) {
      if (!overId.startsWith("day-")) return;
      const newDay = parseInt(overId.replace("day-", ""), 10);
      const groupId = entryId.slice("group:".length);
      const group = localGroups.find((g) => g.id === groupId);
      if (!group || group.dayOfWeek === newDay) return;
      setLocalGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, dayOfWeek: newDay } : g))
      );
      setLocalEntries((prev) =>
        prev.map((e) => (e.groupId === groupId ? { ...e, dayOfWeek: newDay } : e))
      );
      setSelectedDay(newDay);
      writer.updateGroup(groupId, { dayOfWeek: newDay });
      return;
    }

    if (overId === "week-next") return moveEntry(entryId, 0, nextWeek);
    if (overId === "week-prev") return moveEntry(entryId, 6, prevWeek);

    const newDay = parseInt(overId.replace("day-", ""), 10);
    const entry = localEntries.find((e) => e.id === entryId);
    if (!entry || entry.dayOfWeek === newDay) return;

    // Follow the meal to its new day
    setSelectedDay(newDay);
    moveEntry(entryId, newDay);
  }

  // A combined meal counts as one meal, and its time is its longest dish —
  // the dishes cook alongside each other.
  const dayItems = useMemo(() => groupEntries(localEntries, localGroups), [localEntries, localGroups]);
  const totalMeals = dayItems.length;

  // Outside meals by day, and the slots they take: a recipe still planned in
  // one won't be cooked, so it doesn't count towards the week.
  const outsideByDay = useMemo(() => {
    const byDay = new Map<number, OutsideMealView[]>();
    for (const m of localOutside) {
      const day = dayInWeek(weekStartDate, m.date);
      if (day < 0) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), m]);
    }
    return byDay;
  }, [localOutside, weekStartDate]);
  const takenSlot = useCallback(
    (dayOfWeek: number, mealType: MealType) =>
      (outsideByDay.get(dayOfWeek) ?? []).some((m) => m.mealType === mealType),
    [outsideByDay]
  );
  const countedEntries = useMemo(
    () => localEntries.filter((e) => !takenSlot(e.dayOfWeek, e.mealType)),
    [localEntries, takenSlot]
  );

  // Nutrition summary and swap suggestions, recomputed as entries move.
  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const nutritionSummary = useMemo(
    () =>
      summariseMeals([
        ...countedEntries.map((e) => {
          const r = recipeById.get(e.recipe.id);
          return {
            recipeId: e.recipe.id,
            calories: r?.calories ?? null,
            saturatedFatG: r?.saturatedFatG ?? null,
            fiberG: r?.fiberG ?? null,
            ingredientNames: r?.ingredientNames ?? [],
          };
        }),
        // What was eaten out counts like anything cooked: a steak out is the
        // week's red meat.
        ...[...outsideByDay.values()].flat().filter(countsAsMeal).map(outsideMealFacts),
      ]),
    [countedEntries, recipeById, outsideByDay]
  );
  const suggestions = useMemo(
    () =>
      heartFocus
        ? suggestSwaps(
            countedEntries.map((e) => ({
              id: e.id,
              dayOfWeek: e.dayOfWeek,
              mealType: e.mealType,
              recipeId: e.recipe.id,
            })),
            recipes,
            nutritionSummary.proteins
          )
        : [],
    [heartFocus, countedEntries, recipes, nutritionSummary]
  );
  const suggestionByEntry = useMemo(
    () => new Map(suggestions.map((sg) => [sg.entryId, sg])),
    [suggestions]
  );

  // Opened from the heart pill under the week title (or a day's 💡).
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const changeNutritionOpen = setNutritionOpen;
  const [adding, setAdding] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  function showSuggestions() {
    changeNutritionOpen(true);
    requestAnimationFrame(() =>
      document.getElementById("week-nutrition")?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }

  const selectedDayItems = dayItems
    .filter((item) => itemDay(item) === selectedDay)
    // As the household arranged the day (positions from the app's drag to
    // reorder), then by meal type — the only order until someone reorders.
    .sort(
      (a, b) =>
        itemPosition(a) - itemPosition(b) ||
        MEAL_TYPE_ORDER.indexOf(a.mealType) - MEAL_TYPE_ORDER.indexOf(b.mealType)
    );
  const selectedDayGroups = selectedDayItems.flatMap((i) => (i.kind === "group" ? [i.group] : []));
  const selectedDayLoose = selectedDayItems.flatMap((i) => (i.kind === "entry" ? [i.entry] : []));
  const savedMealById = useMemo(
    () => new Map(savedMeals.map((m) => [m.id, m])),
    [savedMeals]
  );

  /**
   * Recipes likely to fill a role, to list first in the add/swap picker: ones
   * already used in that role in a saved meal or on the plan, plus recipes
   * tagged with the role ("side", "sauce"…).
   */
  const preferredFor = useCallback(
    (role: MealRole): string[] => {
      const ids = new Set<string>();
      for (const m of savedMeals) {
        for (const slot of m.slots) {
          if (slot.role === role) for (const o of slot.options) ids.add(o.recipe.id);
        }
      }
      for (const e of localEntries) if (e.mealRole === role) ids.add(e.recipe.id);
      const tagWords = role === "other" ? ["extra", "extras"] : [role, `${role}s`];
      for (const r of recipes) {
        if (r.tags.some((t) => tagWords.includes(t.toLowerCase()))) ids.add(r.id);
      }
      return [...ids];
    },
    [savedMeals, localEntries, recipes]
  );

  /** A meal with choices to make opens the chooser; one without goes straight on. */
  function handleAddSavedMeal(meal: SavedMeal, mealType: MealType) {
    if (needsChoices(meal)) setBuilding({ meal, mealType, dayOfWeek: selectedDay });
    else addSavedMeal(meal, mealType, selectedDay, defaultSelection(meal));
  }

  function addSavedMeal(
    meal: SavedMeal,
    mealType: MealType,
    dayOfWeek: number,
    selection: Record<string, string[]>
  ) {
    writer.addGroup({
      weekStartDate,
      title: meal.title,
      dayOfWeek,
      mealType,
      sourceMealId: meal.id,
      components: selectionToComponents(meal, selection),
      rememberChoices: true,
    });
  }

  const selectedDayLabel = formatDayHeading(weekStartDate, selectedDay);
  const isToday = isCurrentWeek && todayDayIndex === selectedDay;

  const dinnerEntries = localEntries.filter((e) => e.mealType === "dinner");
  const { schedule: dinnerSchedule, updateDay: updateDinnerDay } = useWeekDinnerSchedule(
    weekStartDate,
    dinnerEntries.map((e) => e.recipe.id)
  );
  const selectedDinnerDay = dinnerSchedule?.days[selectedDay];

  const deliveryRefreshKey = `${localEntries
    .map((e) => `${e.id}:${e.dayOfWeek}:${e.mealType}:${e.addedToShoppingListAt ? 1 : 0}`)
    .join("|")}#${shoppingItemCount}`;
  const { panel: deliveryPanel, reload: reloadDeliveries } = useWeekDeliveries(
    weekStartDate,
    deliveryRefreshKey
  );
  const deliveryByDate = new Map((deliveryPanel?.days ?? []).map((d) => [d.date, d]));
  const selectedDelivery = deliveryByDate.get(addDays(weekStartDate, selectedDay));
  const weekAway = deliveryPanel?.away ?? [];
  const awayOn = (date: string) => weekAway.find((p) => p.from <= date && date <= p.to);
  const selectedAway = awayOn(addDays(weekStartDate, selectedDay));

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

  // Meals not yet pushed to the shopping list — generation only adds these. A
  // combined meal counts once, while any of its dishes is still to add.
  const pendingShoppingCount = dayItems.filter((item) =>
    item.kind === "group"
      ? item.entries.some((e) => !e.addedToShoppingListAt)
      : !item.entry.addedToShoppingListAt
  ).length;

  const weekTitle = isCurrentWeek ? "This Week" : formatWeekRange(weekStartDate);

  const selectedDate = addDays(weekStartDate, selectedDay);
  const selectedOutside = [...(outsideByDay.get(selectedDay) ?? [])].sort(
    (a, b) => MEAL_TYPE_ORDER.indexOf(a.mealType) - MEAL_TYPE_ORDER.indexOf(b.mealType)
  );
  const notCookingDinner = selectedOutside.some((m) => m.mealType === "dinner");

  function openOutside(meal: OutsideMealView | null, mealType: MealType = "dinner") {
    setOutsideSheet({ meal, date: meal?.date ?? selectedDate, mealType: meal?.mealType ?? mealType });
  }

  /** Put the saved meal in place straight away; the store follows. */
  function handleOutsideSaved(saved: OutsideMealView | null) {
    const editingId = outsideSheet?.meal?.id;
    setLocalOutside((prev) => {
      const rest = prev.filter((m) => m.id !== (saved?.id ?? editingId));
      return saved && dayInWeek(weekStartDate, saved.date) >= 0 ? [...rest, saved] : rest;
    });
    onOutsideMealsChanged?.();
  }

  // Recipes still planned in the slot the sheet opened on.
  const plannedInSheetSlot = outsideSheet
    ? (() => {
        const day = dayInWeek(weekStartDate, outsideSheet.date);
        return localEntries
          .filter((e) => e.dayOfWeek === day && e.mealType === outsideSheet.mealType)
          .map((e) => e.recipe.title);
      })()
    : [];

  // What each day holds, for the folded rows and the week grid.
  const daySummaries: DaySummary[] = Array.from({ length: 7 }, (_, i) => {
    const slots = MEAL_TYPE_ORDER.map((slot) => {
      const items: SlotItem[] = [
        ...(outsideByDay.get(i) ?? [])
          .filter((m) => m.mealType === slot)
          .map((m) => ({
            key: `out:${m.id}`,
            title: outsideMealLabel(m, OUTSIDE_MEAL_KIND_LABELS[m.kind]),
            thumb: null,
            italic: true,
            outside: true,
          })),
        ...dayItems
          .filter((item) => itemDay(item) === i && item.mealType === slot)
          .sort((a, b) => itemPosition(a) - itemPosition(b))
          .map((item) =>
            item.kind === "group"
              ? {
                  key: item.group.id,
                  title: item.group.title,
                  thumb: (() => {
                    const main = item.entries.find((e) => e.mealRole === "main") ?? item.entries[0];
                    return main ? main.recipe.thumbnailUrl ?? main.recipe.imageUrl : null;
                  })(),
                  italic: true,
                }
              : {
                  key: item.entry.id,
                  title: item.entry.recipe.title,
                  thumb: item.entry.recipe.thumbnailUrl ?? item.entry.recipe.imageUrl,
                }
          ),
      ];
      return { slot: slot as MealSlot, items };
    }).filter((s) => s.items.length > 0);
    const chip = formatDayChip(weekStartDate, i);
    const delivery = deliveryByDate.get(addDays(weekStartDate, i));
    return {
      dayIndex: i,
      short: chip.short,
      date: chip.date,
      isToday: isCurrentWeek && todayDayIndex === i,
      slots,
      hasSuggestion: suggestions.some((sg) => sg.dayOfWeek === i),
      delivery: delivery && delivery.status !== "skipped" ? delivery.status : null,
      away: !!awayOn(addDays(weekStartDate, i)),
      notCooking: (outsideByDay.get(i) ?? []).some((m) => m.mealType === "dinner"),
    };
  });
  const dragging = activeDragEntry !== null || activeDragGroup !== null;

  // The open day: its slots in order, each named (DESIGN.md → Planner).
  const dayMenu = (
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <h2 className="font-serif text-2xl font-semibold">{selectedDayLabel}</h2>
              {isToday && <Badge variant="brand">Today</Badge>}
              {selectedDinnerDay && dinnerSchedule && !notCookingDinner && (
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
                  scheduled={dinnerSchedule.scheduled?.[selectedDay]}
                  onChange={updateDinnerDay}
                />
              )}
              {selectedAway && (
                <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-ink-foreground shadow-sm">
                  <Plane className="h-3 w-3" />
                  {selectedAway.label ? `Away · ${selectedAway.label}` : "Away"}
                </span>
              )}
              {selectedDelivery && deliveryPanel && (
                <DeliveryChip
                  day={selectedDelivery}
                  canEdit={deliveryPanel.canEdit}
                  onChanged={reloadDeliveries}
                />
              )}
              {people && !notCookingDinner && (
                <button
                  type="button"
                  onClick={() => openOutside(null)}
                  className="inline-flex items-center gap-1 rounded-full border border-transparent bg-warning-tint px-2.5 py-0.5 text-xs font-semibold text-warning shadow-sm transition-colors"
                >
                  <UtensilsCrossed className="h-3 w-3" />
                  {selectedDate <= localToday() ? "Ate out?" : "Not cooking?"}
                </button>
              )}
            </div>

            {selectedDayItems.length > 0 || selectedOutside.length > 0 ? (
              <ul className="space-y-3 mb-4">
                {selectedOutside.map((m) => (
                  <OutsideMealCard
                    key={m.id}
                    meal={m}
                    isPast={m.date <= localToday()}
                    onOpen={() => openOutside(m)}
                  />
                ))}
                {selectedDayItems.map((item, i) => (
                  <Fragment key={item.kind === "group" ? item.group.id : item.entry.id}>
                  {(i === 0 || selectedDayItems[i - 1].mealType !== item.mealType) && (
                    <li className="list-none pt-1">
                      <SectionLabel>{SLOT_LABEL[item.mealType]}</SectionLabel>
                    </li>
                  )}
                  {item.kind === "group" ? (
                    <DraggableMealGroup
                      group={item.group}
                      entries={item.entries}
                      weekStartDate={weekStartDate}
                      recipes={recipes}
                      writer={writer}
                      preferredFor={preferredFor}
                      sourceMeal={
                        item.group.sourceMealId
                          ? savedMealById.get(item.group.sourceMealId)
                          : undefined
                      }
                    />
                  ) : (
                    <DraggableMealEntry
                      entry={item.entry}
                      weekStartDate={weekStartDate}
                      mutations={mutations}
                      onMove={moveEntry}
                      suggestion={suggestionByEntry.get(item.entry.id)}
                      onShowSuggestion={showSuggestions}
                      onMakeMeal={() => setCombineFrom(item.entry)}
                      joinableGroups={selectedDayGroups}
                      onJoinGroup={(groupId) => writer.setEntryGroup(item.entry.id, groupId, "side")}
                    />
                  )}
                  {/* Still planned in a slot taken by a meal out: it won't be
                      cooked, so it isn't counted — say so, or it looks like it is. */}
                  {takenSlot(selectedDay, item.mealType) && (
                    <li className="-mt-1.5 flex items-center gap-1.5 px-1 text-xs text-warning">
                      <UtensilsCrossed className="h-3 w-3 flex-shrink-0" />
                      Not cooking this {item.mealType} — it isn&rsquo;t counted. Move it to another day to keep it.
                    </li>
                  )}
                  </Fragment>
                ))}
              </ul>
            ) : (
              <div className="py-6 flex flex-col items-center gap-1 mb-2 text-center text-muted-foreground">
                <p className="font-serif text-lg italic">
                  {selectedAway ? "You're away, so nothing to cook." : "Nothing planned for this day yet."}
                </p>
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
                savedMeals={savedMeals}
                onAddSavedMeal={handleAddSavedMeal}
              />
            )}
          </div>
  );

  return (
    <div
      ref={rootRef}
      className="p-4 lg:p-8 overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
    >
      <DndContext
        id="week-planner"
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div ref={contentRef}>
          {/* ── Header row ── */}
          <div className="flex items-center gap-1 mb-1">
            <DroppableWeekArrow
              direction="prev"
              targetLabel={formatDayChip(prevWeek, 6).short + " " + formatDayChip(prevWeek, 6).date}
              isDragActive={activeDragEntry !== null}
              onClick={() => navigate(prevWeek, "prev")}
            />

            <div className="relative flex-1 min-w-0">
              <button
                onClick={() => setCalendarOpen((v) => !v)}
                className="flex min-w-0 max-w-full items-center gap-1 rounded-xl px-1.5 py-0.5 hover:bg-muted transition-colors group"
              >
                <h1 className="min-w-0 truncate font-serif text-2xl font-semibold leading-tight sm:text-3xl lg:text-4xl">{weekTitle}</h1>
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

            <DroppableWeekArrow
              direction="next"
              targetLabel={formatDayChip(nextWeek, 0).short + " " + formatDayChip(nextWeek, 0).date}
              isDragActive={activeDragEntry !== null}
              onClick={() => navigate(nextWeek, "next")}
            />

            {/* The orange +: add a meal, generate a plan, or send the week to the list */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex-shrink-0 h-11 w-11 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center transition-colors ml-1"
                  aria-label="Add or plan"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem disabled={recipes.length === 0} onSelect={() => setAdding(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add meal
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push("/ai-concierge?tab=plan")}>
                  <Sparkles className="mr-2 h-4 w-4 text-foreground" />
                  Generate plan…
                </DropdownMenuItem>
                {people && (
                  <DropdownMenuItem onSelect={() => openOutside(null)}>
                    <UtensilsCrossed className="mr-2 h-4 w-4 text-warning" />
                    Not cooking — eating out…
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {totalMeals > 0 && planId && pendingShoppingCount > 0 ? (
                  <DropdownMenuItem disabled={shoppingPending} onSelect={handleGenerateShopping}>
                    <ShoppingCart className="mr-2 h-4 w-4 text-foreground" />
                    {shoppingPending
                      ? "Adding…"
                      : `Add ${pendingShoppingCount} meal${pendingShoppingCount === 1 ? "" : "s"} to shopping list`}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => router.push("/shopping")}>
                    {totalMeals > 0 ? (
                      <Check className="mr-2 h-4 w-4 text-success" />
                    ) : (
                      <ShoppingCart className="mr-2 h-4 w-4 text-foreground" />
                    )}
                    {totalMeals > 0 ? "All on the list — " : ""}
                    {shoppingItemCount > 0 ? `${shoppingItemCount} to buy` : "Shopping list"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {recipes.length > 0 && (
              <AddEntryDialog
                weekStartDate={weekStartDate}
                dayOfWeek={selectedDay}
                dayLabel={selectedDayLabel}
                recipes={recipes}
                onAdd={mutations?.addEntry}
                savedMeals={savedMeals}
                onAddSavedMeal={handleAddSavedMeal}
                open={adding}
                onOpenChange={(o) => {
                  setAdding(o);
                  if (!o) setAddSlot(undefined);
                }}
                defaultMealType={addSlot}
              />
            )}
          </div>

          {/* Next order and the week's nutrition, as small pills — the order
              only while it has something to do */}
          {(() => {
            const next = deliveryPanel?.next;
            const toDo = next ? deliveryToDo(next) : 0;
            const showDelivery = !!next && (next.status !== "ordered" || toDo > 0);
            const showNutrition = nutritionSummary.meals > 0;
            if (!showDelivery && !showNutrition && !weekAway.length) return <div className="mb-4" />;
            const offTargets = heartFocus
              ? (Object.keys(WEEKLY_PROTEIN_TARGETS) as ProteinKind[]).filter(
                  (k) => meetsTarget(k, nutritionSummary.proteins[k]) === false
                ).length
              : 0;
            return (
              <div className="mb-4 flex flex-wrap items-center gap-2 pl-9">
                {weekAway.map((p) => {
                  // Jump to the holiday's first day in this week.
                  const first = p.from > weekStartDate ? p.from : weekStartDate;
                  const day = Math.round(
                    (Date.parse(first + "T00:00:00Z") - Date.parse(weekStartDate + "T00:00:00Z")) / 86_400_000
                  );
                  return (
                    <button
                      key={p.from + p.to}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-transparent bg-muted px-2.5 text-xs font-semibold text-foreground shadow-sm transition-colors"
                    >
                      <Plane className="h-3.5 w-3.5 text-foreground" />
                      Away {formatAwayRange(p.from, p.to)}
                      {p.label && <span className="font-normal text-foreground">· {p.label}</span>}
                    </button>
                  );
                })}
                {showDelivery && next && (
                  <button
                    type="button"
                    onClick={() => setDeliveryOpen(true)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-transparent bg-success-tint px-2.5 text-xs font-semibold shadow-sm transition-colors hover:bg-success-tint"
                  >
                    <Truck className="h-3.5 w-3.5 text-success" />
                    {next.status === "ordered" ? `Ordered for ${next.day}` : `Order for ${next.day}`}
                    {toDo > 0 && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="inline-flex items-center gap-1 text-warning">
                          <AlertTriangle className="h-3 w-3" />
                          {toDo} to do
                        </span>
                      </>
                    )}
                  </button>
                )}
                {showNutrition && (
                  <button
                    type="button"
                    onClick={() => changeNutritionOpen(!nutritionOpen)}
                    aria-expanded={nutritionOpen}
                    aria-label={`${
                      nutritionSummary.withNutrition
                        ? `${nutritionSummary.heartHealthy} of ${nutritionSummary.withNutrition} meals heart-healthy`
                        : "This week’s nutrition"
                    }${suggestions.length ? `, ${suggestions.length} swaps suggested` : ""}`}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-full border bg-highlight px-2.5 text-xs font-semibold shadow-sm transition-colors hover:bg-highlight ${
                      offTargets > 0
                        ? "border-input"
                        : "border-border"
                    } ${nutritionOpen ? "ring-2 ring-primary" : ""}`}
                  >
                    <Heart className="h-3.5 w-3.5 fill-primary text-primary" />
                    {nutritionSummary.withNutrition
                      ? `${nutritionSummary.heartHealthy}/${nutritionSummary.withNutrition}`
                      : "Nutrition"}
                    {suggestions.length > 0 ? (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <Lightbulb className="h-3 w-3" />
                          {suggestions.length} swap{suggestions.length === 1 ? "" : "s"}
                        </span>
                      </>
                    ) : offTargets > 0 ? (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="inline-flex items-center gap-1 text-warning">
                          <AlertTriangle className="h-3 w-3" />
                          {offTargets} off
                        </span>
                      </>
                    ) : null}
                  </button>
                )}
              </div>
            );
          })()}

          {nutritionOpen && (
            <WeekNutritionPanel
              summary={nutritionSummary}
              heartFocus={heartFocus}
              suggestions={suggestions}
              topIngredients={topIngredients}
              open
              onOpenChange={changeNutritionOpen}
              weekStartDate={weekStartDate}
              mutations={mutations}
              onSelectDay={setSelectedDay}
            />
          )}

          {deliveryPanel?.next && (
            <Dialog open={deliveryOpen} onOpenChange={setDeliveryOpen}>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Next order</DialogTitle>
                </DialogHeader>
                <NextDeliveryCard
                  next={deliveryPanel.next}
                  canEdit={deliveryPanel.canEdit}
                  onChanged={reloadDeliveries}
                />
              </DialogContent>
            </Dialog>
          )}

          {layout === "grid" ? (
            <>
              <WeekGrid
                days={daySummaries}
                selectedDay={selectedDay}
                isDragActive={dragging}
                onSelect={setSelectedDay}
                onAdd={(day, slot) => {
                  setSelectedDay(day);
                  setAddSlot(slot);
                  setAdding(true);
                }}
              />
              <div className="mt-6 max-w-3xl rounded-2xl bg-highlight p-5">{dayMenu}</div>
            </>
          ) : layout === "split" ? (
            <div className="grid grid-cols-[290px_minmax(0,1fr)] items-start gap-6">
              <div className="space-y-1.5">
                {daySummaries.map((d) => (
                  <DayRow
                    key={`${weekStartDate}-${d.dayIndex}`}
                    day={d}
                    selected={selectedDay === d.dayIndex}
                    isDragActive={dragging}
                    onSelect={() => setSelectedDay(d.dayIndex)}
                  />
                ))}
                <div className="pt-3">
                  <WeekGlance days={daySummaries} />
                </div>
              </div>
              <div className="rounded-2xl bg-highlight p-5">{dayMenu}</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {daySummaries.map((d) => (
                <DayRow
                  key={`${weekStartDate}-${d.dayIndex}`}
                  day={d}
                  selected={selectedDay === d.dayIndex}
                  open={selectedDay === d.dayIndex}
                  isDragActive={dragging}
                  onSelect={() => setSelectedDay(d.dayIndex)}
                >
                  {dayMenu}
                </DayRow>
              ))}
            </div>
          )}
        </div>

        {people && (
          <OutsideMealSheet
            open={outsideSheet !== null}
            onOpenChange={(o) => !o && setOutsideSheet(null)}
            meal={outsideSheet?.meal ?? null}
            defaults={{ date: outsideSheet?.date ?? selectedDate, mealType: outsideSheet?.mealType ?? "dinner" }}
            members={people.members}
            ownName={people.ownName}
            storageAvailable={people.storageAvailable}
            plannedInSlot={plannedInSheetSlot}
            onSaved={handleOutsideSaved}
          />
        )}

        <BuildMealDialog
          meal={building?.meal ?? null}
          dayLabel={building ? formatDayHeading(weekStartDate, building.dayOfWeek) : ""}
          onOpenChange={(o) => !o && setBuilding(null)}
          onConfirm={(selection) => {
            if (building) {
              addSavedMeal(building.meal, building.mealType, building.dayOfWeek, selection);
            }
            setBuilding(null);
          }}
        />

        {combineFrom && (
          <CombineMealDialog
            open
            onOpenChange={(o) => !o && setCombineFrom(null)}
            anchor={combineFrom}
            candidates={selectedDayLoose.filter((e) => e.id !== combineFrom.id)}
            weekStartDate={weekStartDate}
            writer={writer}
          />
        )}

        {/* Drag overlay — floating card shown while dragging */}
        <DragOverlay dropAnimation={null}>
          {activeDragGroup ? (
            <div className="rounded-2xl bg-card ring-2 ring-primary shadow-2xl px-4 py-3 flex items-center gap-3 w-72 cursor-grabbing rotate-1">
              <div className="min-w-0">
                <SectionLabel>
                  {OVERLAY_MEAL_LABEL[activeDragGroup.group.mealType]} · {activeDragGroup.count} dishes
                </SectionLabel>
                <p className="font-serif font-semibold italic leading-snug line-clamp-1">
                  {activeDragGroup.group.title}
                </p>
              </div>
            </div>
          ) : activeDragEntry ? (
            <div className="rounded-2xl bg-card ring-2 ring-primary shadow-2xl px-3 py-2.5 flex items-center gap-3 w-72 cursor-grabbing rotate-1">
              <Plate
                src={activeDragEntry.recipe.thumbnailUrl ?? activeDragEntry.recipe.imageUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-lg"
              />
              <div className="min-w-0">
                <SectionLabel>{OVERLAY_MEAL_LABEL[activeDragEntry.mealType]}</SectionLabel>
                <p className="font-serif font-semibold leading-snug line-clamp-1">
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
