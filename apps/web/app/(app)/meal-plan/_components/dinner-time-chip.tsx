"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { AlarmClock, BellOff, BellRing, Loader2, RotateCcw } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@dishes/ui";
import { toast } from "@/hooks/use-toast";
import {
  getWeekDinnerSchedule,
  setDayDinnerReminder,
  setDayDinnerTime,
} from "@/app/actions/dinner-reminders";
import type { DayDinnerSetting, WeekDinnerSchedule } from "@/lib/dinner-reminders/schedule";

export interface DinnerDish {
  recipeId: string;
  title: string;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
}

function toTime(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Dinner times for the visible week, loaded per week rather than with the page
 * because the planner can change weeks from the local store without a server
 * render.
 */
export function useWeekDinnerSchedule(weekStartDate: string, recipeIds: string[]) {
  const [schedule, setSchedule] = useState<WeekDinnerSchedule | null>(null);
  const idsKey = [...new Set(recipeIds)].sort().join(",");

  useEffect(() => {
    let cancelled = false;
    getWeekDinnerSchedule(weekStartDate, idsKey ? idsKey.split(",") : [])
      .then((s) => {
        if (!cancelled) setSchedule(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [weekStartDate, idsKey]);

  const updateDay = useCallback((day: DayDinnerSetting) => {
    setSchedule((prev) =>
      prev
        ? { ...prev, days: prev.days.map((d) => (d.dayOfWeek === day.dayOfWeek ? day : d)) }
        : prev
    );
  }, []);

  return { schedule, updateDay };
}

/** The longest dish sets the start time, matching the reminder itself. */
function startBy(
  day: DayDinnerSetting,
  dishes: DinnerDish[],
  estimates: WeekDinnerSchedule["estimates"]
): { time: string; dish: string; explanation: string | null } | null {
  let best: { minutes: number; dish: string; explanation: string | null } | null = null;
  for (const d of dishes) {
    const est = estimates[d.recipeId];
    const minutes =
      est?.minutes ?? ((d.prepTimeMinutes ?? 0) + (d.cookTimeMinutes ?? 0) || 45);
    if (!best || minutes > best.minutes) {
      best = { minutes, dish: d.title, explanation: est?.explanation ?? null };
    }
  }
  if (!best) return null;
  return {
    time: toTime(toMinutes(day.time) - best.minutes),
    dish: best.dish,
    explanation: best.explanation,
  };
}

export function DinnerTimeChip({
  date,
  dayLabel,
  day,
  dishes,
  estimates,
  onChange,
}: {
  /** "YYYY-MM-DD" of the day shown. */
  date: string;
  dayLabel: string;
  day: DayDinnerSetting;
  dishes: DinnerDish[];
  estimates: WeekDinnerSchedule["estimates"];
  onChange: (day: DayDinnerSetting) => void;
}) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(day.time);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setTime(day.time);
  }, [open, day.time]);

  const start = startBy(day, dishes, estimates);

  function run(action: () => Promise<DayDinnerSetting>, done?: string) {
    startTransition(async () => {
      try {
        onChange(await action());
        if (done) toast({ title: done });
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Couldn't update dinner time",
          description: err instanceof Error ? err.message : undefined,
        });
      }
    });
  }

  const chipClass = !day.reminderEnabled
    ? "bg-muted text-muted-foreground border border-dashed"
    : day.overridden
      ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-md"
      : "bg-orange-100/80 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-900";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all hover:brightness-105 active:scale-95 ${chipClass}`}
        aria-label={`Dinner time ${day.time}${day.overridden ? ", changed for this day" : ""}`}
      >
        {day.reminderEnabled ? (
          <AlarmClock className="h-3.5 w-3.5" />
        ) : (
          <BellOff className="h-3.5 w-3.5" />
        )}
        <span>Dinner {day.time}</span>
        {day.overridden && <span className="opacity-85">· changed</span>}
        {start && day.reminderEnabled && !day.overridden && (
          <span className="hidden sm:inline opacity-75">· start {start.time}</span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Dinner on {dayLabel}</DialogTitle>
            <DialogDescription>
              A change here applies to this date only. Your usual times stay as they are.
            </DialogDescription>
          </DialogHeader>

          {start ? (
            <div className="rounded-lg bg-gradient-to-br from-orange-500/15 to-rose-500/10 border border-orange-300/50 dark:border-orange-900/60 p-3 text-sm">
              <p>
                Start <strong>{start.dish}</strong> by <strong>{start.time}</strong>
              </p>
              {start.explanation && (
                <p className="text-muted-foreground mt-0.5">It {start.explanation}.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No dinner planned for this day yet.</p>
          )}

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => setDayDinnerTime(date, time), `Dinner set to ${time} for ${dayLabel}`);
            }}
          >
            <label htmlFor="day-dinner-time" className="text-sm font-medium">
              Dinner time
            </label>
            <div className="flex gap-2">
              <Input
                id="day-dinner-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                disabled={pending}
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={pending || !time || time === day.time}
                className="bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white border-0 shadow-md"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save for this day"}
              </Button>
            </div>
            {day.overridden && (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={pending}
                onClick={() =>
                  run(() => setDayDinnerTime(date, null), `Back to ${day.defaultTime}`)
                }
              >
                <RotateCcw className="h-4 w-4" />
                Use default ({day.defaultTime})
              </Button>
            )}
          </form>

          <button
            type="button"
            role="switch"
            aria-checked={day.reminderEnabled}
            disabled={pending}
            onClick={() => run(() => setDayDinnerReminder(date, !day.reminderEnabled))}
            className={`flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm transition-colors ${
              day.reminderEnabled
                ? "bg-emerald-500/10 border border-emerald-300/60 dark:border-emerald-900/60"
                : "bg-muted border border-dashed"
            }`}
          >
            {day.reminderEnabled ? (
              <BellRing className="h-4 w-4 text-emerald-600" />
            ) : (
              <BellOff className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="flex-1">
              <span className="font-medium">
                {day.reminderEnabled ? "Reminder on" : "No reminder this day"}
              </span>
              <span className="block text-muted-foreground text-xs">
                {day.reminderEnabled
                  ? "Tap to skip it, e.g. eating out or someone else is cooking."
                  : "Tap to turn the reminder back on."}
              </span>
            </span>
          </button>

          <Link
            href="/settings/dinner-reminders"
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Change usual dinner times →
          </Link>
        </DialogContent>
      </Dialog>
    </>
  );
}
