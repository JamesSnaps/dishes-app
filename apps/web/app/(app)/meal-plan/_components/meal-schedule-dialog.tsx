"use client";

import { useEffect, useState, useTransition } from "react";
import { AlarmClock, AlertTriangle, Loader2, RotateCcw, Sparkles, UtensilsCrossed } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@dishes/ui";
import {
  clearMealTimeline,
  getMealSchedule,
  planMealTimelineWithAi,
  setMealServeAt,
} from "@/app/actions/meal-timeline";
import type { MealSchedule } from "@/lib/services/meal-timeline";
import { cueClock } from "@/lib/meal-timeline";
import { useToast } from "@/hooks/use-toast";

function formatLead(minutes: number): string {
  const m = Math.abs(minutes);
  if (m === 0) return "serve";
  return m < 60 ? `−${m}m` : `−${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

/**
 * The cooking schedule for a planned meal: what to start when, worked back
 * from the time it should be ready. Simple timing by default; "Plan with AI"
 * produces a smarter one (oven sharing, resting, overlapping prep) that's kept
 * until the dishes change.
 */
export function MealScheduleDialog({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [schedule, setSchedule] = useState<MealSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState("");
  const [pending, startTransition] = useTransition();
  const [planning, setPlanning] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    startTransition(async () => {
      const res = await getMealSchedule(groupId);
      if (res.ok) {
        setSchedule(res.data);
        setTime(res.data.serveAt ?? "");
      } else setError(res.error);
    });
  }, [open, groupId]);

  function apply(res: Awaited<ReturnType<typeof getMealSchedule>>, success?: string) {
    if (!res.ok) {
      toast({ title: "Couldn't update the schedule", description: res.error, variant: "destructive" });
      return;
    }
    setSchedule(res.data);
    setTime(res.data.serveAt ?? "");
    if (success) toast({ title: success });
  }

  function saveTime(value: string | null) {
    startTransition(async () => apply(await setMealServeAt(groupId, value)));
  }

  function planWithAi() {
    setPlanning(true);
    startTransition(async () => {
      apply(await planMealTimelineWithAi(groupId), "Schedule planned");
      setPlanning(false);
    });
  }

  function useSimple() {
    startTransition(async () => apply(await clearMealTimeline(groupId), "Back to simple timing"));
  }

  const dishTitle = new Map(schedule?.dishes.map((d) => [d.recipeId, d.title]) ?? []);
  const serveAt = schedule?.serveAt ?? null;
  const cues = schedule?.timeline.cues ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-orange-500 to-rose-500 text-white flex items-center justify-center shadow-sm">
              <AlarmClock className="h-4 w-4" />
            </span>
            <span className="min-w-0 line-clamp-1">{schedule?.title ?? "Cooking schedule"}</span>
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !schedule ? (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Working out the timing…
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto -mx-2 px-2 py-1">
            {/* Ready-by time */}
            <div className="rounded-xl bg-gradient-to-br from-orange-50 to-rose-50 dark:from-orange-950/30 dark:to-rose-950/20 border border-orange-200/70 dark:border-orange-900/50 p-3">
              <label htmlFor="serve-at" className="text-xs font-semibold text-muted-foreground">
                Everything ready by
              </label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  id="serve-at"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-32 bg-white dark:bg-black/30 text-base font-semibold"
                />
                <Button
                  size="sm"
                  onClick={() => saveTime(time || null)}
                  disabled={pending || !time || time === serveAt}
                  className="bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white border-0"
                >
                  Set
                </Button>
                {schedule.serveAtSource === "meal" && (
                  <Button size="sm" variant="ghost" onClick={() => saveTime(null)} disabled={pending}>
                    Reset
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {schedule.serveAtSource === "dinner"
                  ? "That day's dinner time. Change it here for this meal only."
                  : schedule.serveAtSource === "meal"
                  ? "Set for this meal."
                  : "Pick a time to turn this into a clock-time schedule."}
              </p>
            </div>

            {/* Source + AI */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  schedule.timeline.source === "ai"
                    ? "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {schedule.timeline.source === "ai" ? <Sparkles className="h-3 w-3" /> : null}
                {schedule.timeline.source === "ai" ? "Planned by AI" : "Simple timing"}
              </span>
              {schedule.aiConfigured && (
                <Button
                  size="sm"
                  onClick={planWithAi}
                  disabled={pending}
                  className="ml-auto bg-gradient-to-r from-violet-600 to-orange-500 hover:from-violet-700 hover:to-orange-600 text-white border-0 shadow-sm"
                >
                  {planning ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-3.5 w-3.5" />
                  )}
                  {schedule.timeline.source === "ai" ? "Replan with AI" : "Plan with AI"}
                </Button>
              )}
              {schedule.timeline.source === "ai" && (
                <Button size="sm" variant="ghost" onClick={useSimple} disabled={pending}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" />
                  Simple
                </Button>
              )}
            </div>
            {schedule.aiStale && (
              <p className="text-xs text-muted-foreground">
                The dishes changed since the AI planned this, so it&apos;s showing simple timing.
                Replan to get the smarter version back.
              </p>
            )}
            {schedule.timeline.source === "auto" && (
              <p className="text-xs text-muted-foreground">
                Each dish runs back to back, finishing together. Steps without a time count as 5
                minutes.{schedule.aiConfigured ? " AI can overlap hands-off steps and share the oven." : ""}
              </p>
            )}

            {schedule.timeline.warnings.length > 0 && (
              <ul className="space-y-1.5 rounded-xl border border-amber-300/70 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/60 p-3">
                {schedule.timeline.warnings.map((w, i) => (
                  <li key={i} className="flex gap-2 text-xs text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {w}
                  </li>
                ))}
              </ul>
            )}

            {/* The schedule */}
            <ol className="relative space-y-1 before:absolute before:left-[3.6rem] before:top-2 before:bottom-2 before:w-px before:bg-orange-200 dark:before:bg-orange-900/60">
              {cues.map((cue) => {
                const serve = cue.id === "serve";
                return (
                  <li key={cue.id} className="relative flex items-start gap-3">
                    <span className="w-12 shrink-0 pt-1 text-right font-mono text-sm font-semibold tabular-nums">
                      {serveAt ? cueClock(serveAt, cue.offsetMinutes) : formatLead(cue.offsetMinutes)}
                    </span>
                    <span
                      className={`relative z-10 mt-2 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background ${
                        serve ? "bg-rose-500" : cue.stepIndex === null ? "bg-violet-500" : "bg-orange-500"
                      }`}
                    />
                    <span
                      className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm ${
                        serve
                          ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white font-semibold shadow-sm flex items-center gap-1.5"
                          : cue.stepIndex === null
                          ? "bg-violet-50 dark:bg-violet-950/30 text-violet-900 dark:text-violet-200 italic"
                          : "bg-muted/50"
                      }`}
                    >
                      {serve && <UtensilsCrossed className="h-3.5 w-3.5" />}
                      {cue.recipeId && !serve && (
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300 not-italic">
                          {dishTitle.get(cue.recipeId) ?? "Dish"}
                          {cue.stepIndex !== null && ` · step ${cue.stepIndex + 1}`}
                        </span>
                      )}
                      {cue.text}
                      {serve && cue.covers?.length ? (
                        <span className="font-normal opacity-90">
                          {" — "}
                          {cue.covers.map((c) => dishTitle.get(c.recipeId) ?? "Dish").join(", ")}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>

            <p className="text-xs text-muted-foreground">
              With dinner reminders on (Settings → Dinner reminders) you&apos;ll get a notification
              as each step comes up, plus a heads-up before the first one.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
