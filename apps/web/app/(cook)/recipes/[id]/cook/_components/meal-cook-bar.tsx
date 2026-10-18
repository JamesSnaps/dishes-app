"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, ChefHat, Clock, Pause, Play, RotateCcw, Timer, UtensilsCrossed } from "lucide-react";
import { Button } from "@dishes/ui";
import { useMealCook } from "./meal-cooking";
import {
  formatTimer,
  mealCues,
  mostUrgentTimer,
  useCookSession,
  type CookCue,
  type CookSession,
} from "@/components/providers/cook-session-provider";

/** The clock, refreshed every half minute — enough for schedule cues. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const onVisible = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return now;
}

export function clockOf(epoch: number): string {
  return new Date(epoch).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** A cue counts as "now" for a few minutes after its time, then it's past. */
const CUE_NOW_MS = 5 * 60_000;

/**
 * The cooks belonging to one planned meal, in the meal's dish order (main
 * first). Sessions only — a dish whose cook was finished drops out.
 */
function useMealSessions(groupId: string): CookSession[] {
  const { sessions } = useCookSession();
  return useMemo(() => {
    const own = sessions.filter((s) => s.meal?.groupId === groupId);
    const order = own[0]?.meal?.order ?? [];
    return own.sort((a, b) => order.indexOf(a.recipeId) - order.indexOf(b.recipeId));
  }, [sessions, groupId]);
}

/**
 * Bring another dish of the meal to the front — no minimising, one tap. With
 * the whole meal loaded (MealCooking) it's instant; otherwise a page change.
 */
function useSwitchDish() {
  const router = useRouter();
  const ctx = useMealCook();
  const { activateSession, setStepIndex } = useCookSession();
  return (recipeId: string, stepIndex?: number | null) => {
    if (ctx) return ctx.showDish(recipeId, stepIndex);
    activateSession(recipeId);
    if (stepIndex != null) setStepIndex(stepIndex, recipeId);
    router.push(`/recipes/${recipeId}/cook`);
  };
}

// ─── Dish tabs ────────────────────────────────────────────────────────────────

/**
 * One tab per dish of the meal being cooked. Each shows where that dish is up
 * to and its most urgent timer, and pulses when a timer has finished, so the
 * whole roast is visible at a glance from whichever dish is on screen.
 */
export function MealDishTabs({
  groupId,
  currentRecipeId,
  onChangeStart,
}: {
  groupId: string;
  currentRecipeId: string;
  /** "Started at a different time…" */
  onChangeStart: () => void;
}) {
  const { timersFor } = useCookSession();
  const dishes = useMealSessions(groupId);
  const switchTo = useSwitchDish();
  const now = useNow();

  if (dishes.length < 2) return null;
  const meal = dishes[0]?.meal;
  const title = meal?.title;
  const upcoming = mealCues(meal).filter((c) => c.at + CUE_NOW_MS > now);
  const nextFor = (recipeId: string) => upcoming.find((c) => c.recipeId === recipeId);
  const nextUp = upcoming.find((c) => c.id !== "serve") ?? upcoming[0];
  const dishTitle = new Map(dishes.map((d) => [d.recipeId, d.recipeTitle]));

  return (
    <div className="border-t bg-gradient-to-r from-orange-50 via-amber-50/70 to-rose-50 dark:from-orange-950/30 dark:via-amber-950/10 dark:to-rose-950/20">
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-2 scrollbar-none">
        <span className="hidden sm:flex shrink-0 items-center gap-1.5 pr-1 text-xs font-semibold text-orange-800 dark:text-orange-200">
          <UtensilsCrossed className="h-3.5 w-3.5" />
          <span className="max-w-[10rem] truncate">{title}</span>
        </span>
        {dishes.map((dish) => {
          const current = dish.recipeId === currentRecipeId;
          const urgent = mostUrgentTimer(timersFor(dish.recipeId));
          const ringing = dish.finishedAlerts.length > 0;
          return (
            <button
              key={dish.recipeId}
              type="button"
              onClick={() => !current && switchTo(dish.recipeId)}
              aria-current={current ? "page" : undefined}
              className={`relative flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-all ${
                current
                  ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-md"
                  : "bg-white/90 dark:bg-black/30 border border-orange-200 dark:border-orange-900/60 shadow-sm hover:border-orange-400 hover:shadow"
              }`}
            >
              {dish.recipeImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dish.recipeImageUrl} alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" />
              ) : (
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                    current ? "bg-white/20" : "bg-muted"
                  }`}
                >
                  <ChefHat className="h-3.5 w-3.5" />
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <span className="max-w-[9rem] truncate text-xs font-semibold leading-tight">
                  {dish.recipeTitle}
                </span>
                <span
                  className={`flex items-center gap-1 text-[11px] leading-tight ${
                    current ? "text-white/85" : "text-muted-foreground"
                  }`}
                >
                  {urgent ? (
                    <>
                      <Timer className="h-3 w-3" />
                      <span
                        className={`font-mono tabular-nums ${
                          urgent[1].done
                            ? `font-semibold ${current ? "" : "text-green-600 dark:text-green-400"}`
                            : ""
                        }`}
                      >
                        {urgent[1].done ? "Done!" : formatTimer(urgent[1].remaining)}
                      </span>
                    </>
                  ) : nextFor(dish.recipeId) ? (
                    <>
                      <AlarmClock className="h-3 w-3" />
                      <span className="tabular-nums">Next {clockOf(nextFor(dish.recipeId)!.at)}</span>
                    </>
                  ) : (
                    <>
                      Step {dish.stepIndex + 1}/{dish.stepCount}
                    </>
                  )}
                </span>
              </span>
              {ringing && (
                <span
                  className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-green-500 ring-2 ring-background animate-pulse"
                  aria-label="Timer finished"
                />
              )}
            </button>
          );
        })}
      </div>
      {nextUp && (
        <div className="flex items-center border-t border-orange-200/60 dark:border-orange-900/40">
        <button
          type="button"
          onClick={() => nextUp.recipeId && switchTo(nextUp.recipeId, nextUp.stepIndex)}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-xs"
        >
          <AlarmClock className="h-3.5 w-3.5 shrink-0 text-orange-600 dark:text-orange-400" />
          <span
            className={`shrink-0 font-mono font-semibold tabular-nums ${
              nextUp.at <= now ? "text-rose-600 dark:text-rose-400" : ""
            }`}
          >
            {nextUp.at <= now ? "Now" : clockOf(nextUp.at)}
          </span>
          <span className="min-w-0 truncate text-muted-foreground">
            {nextUp.recipeId && (
              <span className="font-semibold text-foreground">{dishTitle.get(nextUp.recipeId)}: </span>
            )}
            {nextUp.text}
          </span>
        </button>
        <button
          type="button"
          onClick={onChangeStart}
          title="Started at a different time…"
          className="mr-2 flex shrink-0 items-center gap-1 rounded-lg border border-orange-300 bg-white/90 px-2 py-1 text-[11px] font-semibold text-orange-800 shadow-sm hover:border-orange-500 dark:border-orange-800 dark:bg-black/30 dark:text-orange-200"
        >
          <Clock className="h-3 w-3" />
          <span className="hidden sm:inline">Started at a different time…</span>
          <span className="sm:hidden">Started…</span>
        </button>
        </div>
      )}
    </div>
  );
}

// ─── Meal timeline ────────────────────────────────────────────────────────────

/**
 * The meal's whole schedule against the clock: done cues faded, the current
 * one highlighted, the rest to come. Tapping a step jumps to that dish at that
 * step.
 */
export function MealTimelinePanel({
  groupId,
  onChangeStart,
}: {
  groupId: string;
  /** "Started at a different time…" */
  onChangeStart: () => void;
}) {
  const dishes = useMealSessions(groupId);
  const switchTo = useSwitchDish();
  const ctx = useMealCook();
  const now = useNow();
  const meal = dishes[0]?.meal;
  const cues: CookCue[] = ctx?.sequence?.cues ?? mealCues(meal);
  if (!cues.length) return null;

  const dishTitle = new Map(dishes.map((d) => [d.recipeId, d.recipeTitle]));
  // Walking the meal as one sequence: your place in it. Otherwise: the clock.
  const currentId =
    ctx?.sequence?.cue.id ?? [...cues].reverse().find((c) => c.at <= now && c.at + CUE_NOW_MS > now)?.id;
  const pick = (cue: CookCue, i: number) => {
    if (ctx?.sequence) return ctx.goTo(i);
    if (cue.recipeId) switchTo(cue.recipeId, cue.stepIndex);
  };

  return (
    <div className="shrink-0 px-6 py-5 border-t">
      <div className="mb-3 flex flex-col items-start gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <AlarmClock className="h-3.5 w-3.5" />
          Schedule{meal?.serveAt ? ` · ready ${clockOf(meal.serveAt)}` : ""}
        </p>
        <button
          type="button"
          onClick={onChangeStart}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-orange-300 bg-gradient-to-r from-orange-50 to-amber-50 px-2 py-1 text-[11px] font-semibold text-orange-800 shadow-sm hover:border-orange-500 dark:border-orange-800 dark:from-orange-950/40 dark:to-amber-950/20 dark:text-orange-200"
        >
          <Clock className="h-3 w-3" />
          Started at a different time…
        </button>
      </div>
      <ol className="space-y-1">
        {cues.map((cue, i) => {
          const past = ctx?.sequence ? i < ctx.sequence.index : cue.at + CUE_NOW_MS <= now;
          const current = cue.id === currentId;
          return (
            <li key={cue.id}>
              <button
                type="button"
                disabled={!ctx?.sequence && !cue.recipeId}
                onClick={() => pick(cue, i)}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors ${
                  current
                    ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm"
                    : past
                    ? "opacity-45"
                    : "hover:bg-muted/60"
                }`}
              >
                <span className="w-10 shrink-0 font-mono font-semibold tabular-nums">{clockOf(cue.at)}</span>
                <span className="min-w-0">
                  {cue.recipeId && (
                    <span className={`font-semibold ${current ? "" : "text-foreground"}`}>
                      {dishTitle.get(cue.recipeId) ?? "Dish"}:{" "}
                    </span>
                  )}
                  <span className={current ? "" : "text-muted-foreground"}>{cue.text}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Whole-meal timers ────────────────────────────────────────────────────────

/**
 * Timers running (or finished) on the meal's other dishes, controllable from
 * here — "potatoes 12:00, chicken resting 8:00" without leaving this dish. The
 * dish on screen keeps its own timers panel; this lists the rest.
 */
export function MealTimersPanel({
  groupId,
  currentRecipeId,
}: {
  groupId: string;
  currentRecipeId: string;
}) {
  const { timersFor, toggleTimer, resetTimer } = useCookSession();
  const dishes = useMealSessions(groupId).filter((d) => d.recipeId !== currentRecipeId);
  const switchTo = useSwitchDish();

  const rows = dishes.flatMap((dish) =>
    [...timersFor(dish.recipeId).entries()]
      .filter(([, t]) => t.remaining < t.totalSeconds || t.done)
      .map(([idx, timer]) => ({ dish, idx, timer }))
  );
  if (!rows.length) return null;

  return (
    <div className="shrink-0 px-6 py-5 border-t bg-gradient-to-b from-orange-50/60 to-transparent dark:from-orange-950/20">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <UtensilsCrossed className="h-3.5 w-3.5" />
        Rest of the meal
      </p>
      <div className="space-y-2">
        {rows.map(({ dish, idx, timer }) => (
          <div
            key={`${dish.recipeId}:${idx}`}
            className={`rounded-lg border p-2.5 ${
              timer.done
                ? "border-green-500/30 bg-green-500/5"
                : timer.running
                ? "border-orange-500/30 bg-orange-500/5"
                : "border-border bg-muted/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => switchTo(dish.recipeId)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-xs font-semibold hover:underline underline-offset-2">
                  {dish.recipeTitle}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  Step {timer.stepNumber}
                  {timer.label ? ` · ${timer.label}` : ""}
                </span>
              </button>
              <span
                className={`font-mono text-base font-bold tabular-nums ${
                  timer.done
                    ? "text-green-500 animate-pulse"
                    : timer.running && timer.remaining <= 30
                    ? "text-orange-500"
                    : ""
                }`}
              >
                {timer.done ? "Done!" : formatTimer(timer.remaining)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => toggleTimer(idx, dish.recipeId)}
                disabled={timer.done}
                aria-label={timer.running ? "Pause timer" : "Start timer"}
              >
                {timer.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => resetTimer(idx, dish.recipeId)}
                aria-label="Reset timer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
