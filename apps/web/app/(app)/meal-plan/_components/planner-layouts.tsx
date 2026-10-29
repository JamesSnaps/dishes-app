"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Lightbulb, Plane, Plus, Truck, UtensilsCrossed } from "lucide-react";
import { Plate, SectionLabel, cn } from "@dishes/ui";

/**
 * The planner's three layouts, picked by the planner's own width rather than
 * the device (DESIGN.md → Planner): a phone, a narrow split or Slide Over get
 * the fold-up days; iPad portrait the day list beside the open day; iPad
 * landscape and desktop the week grid. The side nav takes its share first, so
 * this measures the planner, not the window.
 */
export type PlannerLayout = "fold" | "split" | "grid";

export function usePlannerLayout(ref: RefObject<HTMLElement | null>): PlannerLayout {
  const [layout, setLayout] = useState<PlannerLayout>("fold");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pick = (w: number): PlannerLayout => (w >= 1100 ? "grid" : w >= 700 ? "split" : "fold");
    setLayout(pick(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setLayout(pick(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return layout;
}

export type MealSlot = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
};

/** One thing in a slot, as the folded row and the week grid show it. */
export type SlotItem = {
  key: string;
  title: string;
  thumb: string | null;
  /** A combined meal's name or a meal out: set in italic. */
  italic?: boolean;
  /** Eating out: the fork-and-knife tile instead of a plate. */
  outside?: boolean;
};

export type DaySummary = {
  dayIndex: number;
  /** "MON" */
  short: string;
  /** "27" */
  date: string;
  isToday: boolean;
  /** Everything that day, in slot order. */
  slots: { slot: MealSlot; items: SlotItem[] }[];
  hasSuggestion: boolean;
  delivery: "scheduled" | "ordered" | null;
  away: boolean;
  notCooking: boolean;
};

function dayHeadline(day: DaySummary): { item: SlotItem | null; count: number } {
  const all = day.slots.flatMap((s) => s.items);
  const dinner = day.slots.find((s) => s.slot === "dinner")?.items[0];
  return { item: dinner ?? all[0] ?? null, count: all.length };
}

function Indicators({ day }: { day: DaySummary }) {
  return (
    <>
      {day.notCooking && <UtensilsCrossed className="h-3 w-3 text-muted-foreground" aria-label="Not cooking" />}
      {day.delivery && (
        <Truck
          className={cn("h-3 w-3", day.delivery === "ordered" ? "text-success" : "text-muted-foreground")}
          aria-label={day.delivery === "ordered" ? "Delivery (ordered)" : "Delivery"}
        />
      )}
      {day.away && <Plane className="h-3 w-3 text-muted-foreground" aria-label="Away" />}
      {day.hasSuggestion && <Lightbulb className="h-3 w-3 text-primary" aria-label="Swap suggested" />}
    </>
  );
}

/**
 * A folded day: the date, the day's dinner (or first meal), "+2 more · 3
 * meals" and its plates. Also where a dragged meal is dropped. With `open`
 * it's the fold-up layout's open day instead, holding `children`.
 */
export function DayRow({
  day,
  selected,
  open = false,
  isDragActive,
  onSelect,
  children,
}: {
  day: DaySummary;
  selected: boolean;
  open?: boolean;
  isDragActive: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day.dayIndex}` });
  const { item, count } = dayHeadline(day);
  const thumbs = day.slots.flatMap((s) => s.items).slice(0, 3);

  if (open) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "rounded-2xl bg-highlight p-4 transition-shadow",
          isOver && "ring-2 ring-primary"
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      aria-current={selected ? "date" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all",
        isOver
          ? "bg-highlight ring-2 ring-primary"
          : isDragActive
            ? "border-[1.5px] border-dashed border-input"
            : selected
              ? "bg-card shadow-sm"
              : day.isToday
                ? "bg-highlight"
                : "hover:bg-muted"
      )}
    >
      <span className="flex w-10 shrink-0 flex-col items-center">
        <SectionLabel tone={day.isToday ? "brand" : "muted"} className="text-[10px]">
          {day.short}
        </SectionLabel>
        <span className={cn("font-serif text-2xl font-semibold leading-none", day.isToday && "text-primary")}>
          {day.date}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        {item ? (
          <span className={cn("block truncate font-serif text-[15px] font-semibold", item.italic && "italic")}>
            {item.title}
          </span>
        ) : (
          <span className="block truncate font-serif text-[15px] italic text-muted-foreground">Nothing planned</span>
        )}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {count > 1 && <span>+{count - 1} more · {count} meals</span>}
          <Indicators day={day} />
        </span>
      </span>

      {thumbs.length > 0 && (
        <span className="flex shrink-0 -space-x-2.5">
          {thumbs.map((t) =>
            t.outside ? (
              <span
                key={t.key}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-plate text-foreground/70 ring-2 ring-background"
              >
                <UtensilsCrossed className="h-4 w-4" />
              </span>
            ) : (
              <Plate key={t.key} src={t.thumb} alt="" className="h-9 w-9 rounded-full ring-2 ring-background" />
            )
          )}
        </span>
      )}
    </button>
  );
}

/** The week at a glance, under the day list in the split layout. */
export function WeekGlance({ days, children }: { days: DaySummary[]; children?: ReactNode }) {
  const dinners = days.filter((d) => d.slots.some((s) => s.slot === "dinner" && s.items.length > 0)).length;
  const meals = days.reduce((n, d) => n + d.slots.reduce((m, s) => m + s.items.length, 0), 0);
  return (
    <div className="rounded-2xl bg-muted p-4">
      <SectionLabel>Week at a glance</SectionLabel>
      <dl className="mt-2 flex divide-x divide-border">
        <div className="flex-1 pr-3">
          <dd className="font-serif text-2xl font-semibold">{dinners}/7</dd>
          <dt className="text-xs text-muted-foreground">dinners planned</dt>
        </div>
        <div className="flex-1 pl-3">
          <dd className="font-serif text-2xl font-semibold">{meals}</dd>
          <dt className="text-xs text-muted-foreground">meals in all</dt>
        </div>
      </dl>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** A day's column in the week grid: droppable, with the slots as subgrid rows. */
function GridColumn({
  day,
  rows,
  selected,
  isDragActive,
  onSelect,
  onAdd,
}: {
  day: DaySummary;
  rows: MealSlot[];
  selected: boolean;
  isDragActive: boolean;
  onSelect: () => void;
  onAdd: (slot: MealSlot) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day.dayIndex}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "row-span-full grid grid-rows-subgrid gap-2 rounded-2xl p-1.5 transition-all",
        isOver
          ? "bg-highlight ring-2 ring-primary"
          : day.isToday
            ? "bg-highlight"
            : isDragActive
              ? "outline-dashed outline-[1.5px] outline-input"
              : selected
                ? "bg-muted"
                : ""
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex items-baseline gap-1.5 rounded-xl px-1.5 py-1 text-left hover:bg-muted/70"
      >
        <SectionLabel tone={day.isToday ? "brand" : "muted"}>{day.short}</SectionLabel>
        <span className={cn("font-serif text-xl font-semibold", day.isToday && "text-primary")}>{day.date}</span>
        <span className="ml-auto flex items-center gap-1">
          <Indicators day={day} />
        </span>
      </button>
      {rows.map((slot) => {
        const items = day.slots.find((s) => s.slot === slot)?.items ?? [];
        return (
          <div key={slot} className="flex min-h-[64px] flex-col gap-1.5">
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={onSelect}
                className="flex items-center gap-2 rounded-xl bg-card p-1.5 text-left transition-shadow hover:shadow-md"
              >
                {it.outside ? (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-plate text-foreground/70">
                    <UtensilsCrossed className="h-4 w-4" />
                  </span>
                ) : (
                  <Plate src={it.thumb} alt="" className="h-10 w-10 shrink-0 rounded-lg" />
                )}
                <span
                  className={cn(
                    "line-clamp-2 min-w-0 font-serif text-[13px] font-semibold leading-tight",
                    it.italic && "italic"
                  )}
                >
                  {it.title}
                </span>
              </button>
            ))}
            {items.length === 0 &&
              (slot === "dinner" && !day.notCooking ? (
                <button
                  type="button"
                  onClick={() => onAdd(slot)}
                  className="flex h-full min-h-[52px] items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-input text-xs font-semibold text-primary hover:bg-card"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add dinner
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onAdd(slot)}
                  aria-label={`Add ${SLOT_LABEL[slot].toLowerCase()}`}
                  className="flex h-full min-h-[52px] items-center justify-center rounded-xl text-muted-foreground/40 hover:bg-card hover:text-muted-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Days as columns, slots as rows; today's column on `highlight`. Breakfast,
 * lunch and dinner always show; dessert and snack only in a week that has one.
 */
export function WeekGrid({
  days,
  selectedDay,
  isDragActive,
  onSelect,
  onAdd,
}: {
  days: DaySummary[];
  selectedDay: number;
  isDragActive: boolean;
  onSelect: (day: number) => void;
  onAdd: (day: number, slot: MealSlot) => void;
}) {
  const extra = (["dessert", "snack"] as MealSlot[]).filter((slot) =>
    days.some((d) => d.slots.some((s) => s.slot === slot && s.items.length > 0))
  );
  const rows: MealSlot[] = ["breakfast", "lunch", "dinner", ...extra];
  return (
    <div
      className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] gap-x-1.5 gap-y-2"
      style={{ gridTemplateRows: `auto repeat(${rows.length}, auto)` }}
    >
      <div className="row-span-full grid grid-rows-subgrid gap-2 py-1.5">
        <span />
        {rows.map((slot) => (
          <SectionLabel key={slot} className="pt-3">
            {SLOT_LABEL[slot]}
          </SectionLabel>
        ))}
      </div>
      {days.map((d) => (
        <GridColumn
          key={d.dayIndex}
          day={d}
          rows={rows}
          selected={selectedDay === d.dayIndex}
          isDragActive={isDragActive}
          onSelect={() => onSelect(d.dayIndex)}
          onAdd={(slot) => onAdd(d.dayIndex, slot)}
        />
      ))}
    </div>
  );
}
