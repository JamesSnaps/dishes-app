"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Clock, Loader2, MoveRight, Play } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@dishes/ui";
import { mealCues, useCookSession, type CookCue } from "@/components/providers/cook-session-provider";
import { positionAt, stepsOf } from "@/lib/meal-sequence";
import { shiftMealServeAt } from "@/app/actions/meal-timeline";
import { toast } from "@/hooks/use-toast";
import {
  clockOf,
  firstCue,
  minutesLabel,
  ON_TIME_MINUTES,
  shiftCues,
  startDelta,
  stepAfter,
  suggestedStart,
  timeOnDay,
  toMinute,
} from "@/lib/meal-start";

/**
 * "Schedule says start the lamb at 08:20 for 17:00 — when did you start?"
 *
 * Asked once when a scheduled meal's cook begins, and again from the schedule
 * whenever you remember mid-cook. A start well off the schedule offers to move
 * the meal (serve time, every dish's cues, pushes, the Live Activity and the
 * planner's dinner time all follow) or to keep the serve time, which only
 * moves the first dish's cues here on this device. Starting early also opens
 * that dish on the step the schedule has it on by now — the one time cooking
 * mode moves your step for you.
 */
export function MealStartDialog({
  groupId,
  open,
  onOpenChange,
  atStart,
  currentRecipeId,
  sequence = false,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened as the cook begins (not from the schedule mid-cook). */
  atStart: boolean;
  currentRecipeId: string;
  /** Walking the meal as one sequence: an early start moves your place in it. */
  sequence?: boolean;
}) {
  const router = useRouter();
  const { sessions, updateMeal, setStepIndex, activateSession } = useCookSession();
  const dishes = useMemo(() => sessions.filter((s) => s.meal?.groupId === groupId), [sessions, groupId]);
  const meal = dishes[0]?.meal;
  const first = firstCue(meal?.cues ?? []);
  const dishTitle = dishes.find((d) => d.recipeId === first?.recipeId)?.recipeTitle ?? "the first dish";

  const [time, setTime] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);

  // Fresh each time it opens: now, or the due time when that's close.
  useEffect(() => {
    if (!open || !first) return;
    setStartedAt(null);
    setTime(clockOf(suggestedStart(Date.now(), first.at)));
  }, [open, first?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!meal?.serveAt || !first?.recipeId) return null;
  const serveAt = meal.serveAt;
  const firstRecipeId = first.recipeId;

  const picked = timeOnDay(time, first.at);
  const pickedValid = picked !== null && picked <= Date.now() + 60_000;
  const delta = startedAt === null ? 0 : startDelta(startedAt, first.at);

  /**
   * Done: open where the schedule has you by now, if you're under way — in a
   * meal's sequence, the last step due by now across every dish (`cues`, the
   * meal's times as just set); otherwise the first dish's step.
   */
  const finish = (start: number, cues: CookCue[] = mealCues(meal)) => {
    onOpenChange(false);
    if (!atStart) return;
    if (sequence) {
      if (Date.now() - start < ON_TIME_MINUTES * 60_000) return;
      const at = positionAt(cues, Date.now());
      if (!at) return;
      updateMeal(groupId, (m) => ({ ...m, position: at.id, view: "meal" }));
      for (const st of stepsOf(at)) setStepIndex(st.stepIndex, st.recipeId);
      return;
    }
    const step = stepAfter(meal.cues ?? [], firstRecipeId, Date.now() - start);
    if (step <= 0) return;
    setStepIndex(step, firstRecipeId);
    if (firstRecipeId !== currentRecipeId) {
      activateSession(firstRecipeId);
      router.push(`/recipes/${firstRecipeId}/cook`);
    }
  };

  const choose = (start: number) => {
    const off = startDelta(start, first.at);
    if (Math.abs(off) < ON_TIME_MINUTES) {
      updateMeal(groupId, (m) => ({ ...m, startShift: undefined }));
      finish(start, mealCues({ ...meal, startShift: undefined }));
    } else {
      setStartedAt(start);
    }
  };

  const keep = () => {
    if (startedAt === null) return;
    updateMeal(groupId, (m) => ({ ...m, startShift: { recipeId: firstRecipeId, minutes: delta } }));
    finish(startedAt, mealCues({ ...meal, startShift: { recipeId: firstRecipeId, minutes: delta } }));
  };

  const move = async () => {
    if (startedAt === null) return;
    setMoving(true);
    const res = await shiftMealServeAt(groupId, delta).catch(() => null);
    setMoving(false);
    if (!res?.ok) {
      toast({
        title: "Couldn't move the meal",
        description: res && !res.ok ? res.error : "Please try again.",
        variant: "destructive",
      });
      return;
    }
    updateMeal(groupId, (m) => ({
      ...m,
      startShift: undefined,
      serveAt: (m.serveAt ?? serveAt) + delta * 60_000,
      cues: shiftCues(m.cues ?? [], delta),
    }));
    toast({ title: `Ready by ${clockOf(serveAt + delta * 60_000)} now`, description: "Every dish's times have moved with it." });
    finish(startedAt, shiftCues(meal.cues ?? [], delta));
  };

  const early = delta < 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !moving && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        {startedAt === null ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlarmClock className="h-5 w-5 text-orange-500" />
                {atStart ? "Starting the meal" : "When did you start?"}
              </DialogTitle>
              <DialogDescription>
                Schedule says start <span className="font-semibold text-foreground">{dishTitle}</span> at{" "}
                <span className="font-semibold text-foreground tabular-nums">{clockOf(first.at)}</span> for{" "}
                <span className="font-semibold text-foreground tabular-nums">{clockOf(serveAt)}</span>.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-4 dark:border-orange-900/60 dark:from-orange-950/30 dark:to-amber-950/20">
              <Label htmlFor="meal-started-at" className="text-sm font-semibold">
                I started at…
              </Label>
              <Input
                id="meal-started-at"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-2 h-12 bg-white text-lg font-semibold tabular-nums dark:bg-black/30"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              {atStart && (
                <Button
                  size="lg"
                  className="flex-1 bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-md hover:from-orange-600 hover:to-rose-600"
                  onClick={() => choose(toMinute(Date.now()))}
                >
                  <Play className="mr-1.5 h-4 w-4" />
                  Start now
                </Button>
              )}
              <Button
                size="lg"
                variant={atStart ? "outline" : "default"}
                className={`flex-1 ${
                  atStart
                    ? "border-2 border-orange-300 dark:border-orange-800"
                    : "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-md hover:from-orange-600 hover:to-rose-600"
                }`}
                disabled={!pickedValid}
                onClick={() => picked !== null && choose(picked)}
              >
                <Clock className="mr-1.5 h-4 w-4" />
                {atStart ? `I started earlier at ${time || "…"}` : `I started at ${time || "…"}`}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MoveRight className="h-5 w-5 text-orange-500" />
                {minutesLabel(delta)} {early ? "early" : "late"} — move dinner?
              </DialogTitle>
              <DialogDescription>
                You started {dishTitle} at <span className="tabular-nums">{clockOf(startedAt)}</span>, not{" "}
                <span className="tabular-nums">{clockOf(first.at)}</span>. Moving the meal shifts every dish&apos;s
                times, the reminders and the planner. Keeping {clockOf(serveAt)} moves {dishTitle}&apos;s early steps, here; its last steps
                still finish for {clockOf(serveAt)}.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                size="lg"
                className="flex-1 bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-md hover:from-orange-600 hover:to-rose-600"
                disabled={moving}
                onClick={move}
              >
                {moving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Move dinner to {clockOf(serveAt + delta * 60_000)}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="flex-1 border-2 border-orange-300 dark:border-orange-800"
                disabled={moving}
                onClick={keep}
              >
                Keep {clockOf(serveAt)}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
