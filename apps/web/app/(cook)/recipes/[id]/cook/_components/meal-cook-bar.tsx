"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Pause, Play, RotateCcw, Timer, UtensilsCrossed } from "lucide-react";
import { Button } from "@dishes/ui";
import {
  formatTimer,
  mostUrgentTimer,
  useCookSession,
  type CookSession,
} from "@/components/providers/cook-session-provider";

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

/** Bring another dish of the meal to the front — no minimising, one tap. */
function useSwitchDish() {
  const router = useRouter();
  const { activateSession } = useCookSession();
  return (recipeId: string) => {
    activateSession(recipeId);
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
}: {
  groupId: string;
  currentRecipeId: string;
}) {
  const { timersFor } = useCookSession();
  const dishes = useMealSessions(groupId);
  const switchTo = useSwitchDish();

  if (dishes.length < 2) return null;
  const title = dishes[0]?.meal?.title;

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
