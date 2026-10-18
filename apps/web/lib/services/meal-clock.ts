import { getMealSchedule } from "@/lib/services/meal-timeline";
import { isFrozen } from "@/lib/meal-timeline";
import { getReminderSettings } from "@/lib/dinner-reminders/schedule";
import { zonedEpoch } from "@/lib/dinner-reminders/time";
import type { HouseholdContext } from "@/lib/session";

/** A planned meal's cooking schedule as real clock times (epoch ms). */
export interface MealClock {
  groupId: string;
  title: string;
  serveAt: number;
  cues: {
    id: string;
    at: number;
    recipeId: string | null;
    stepIndex: number | null;
    dish: string | null;
    text: string;
    /** A combined prep step: the dishes' steps it does. */
    covers?: { recipeId: string; stepIndex: number }[];
  }[];
  /** The schedule is frozen for a cook in progress. */
  frozen: boolean;
}

/**
 * The meal's schedule against the household's clock: what cooking mode's
 * "Now / next" strip, the iOS Live Activity and the cue pushes all count
 * down to. Null when the meal has no serve-at time.
 */
export async function getMealClock(ctx: HouseholdContext, groupId: string): Promise<MealClock | null> {
  const [schedule, settings] = await Promise.all([
    getMealSchedule(ctx, groupId),
    getReminderSettings(ctx.householdId),
  ]);
  if (!schedule.serveAt) return null;
  const serveAt = zonedEpoch(schedule.date, schedule.serveAt, settings.timezone);
  const dish = new Map(schedule.dishes.map((d) => [d.recipeId, d.title]));
  return {
    groupId: schedule.groupId,
    title: schedule.title ?? "Dinner",
    serveAt,
    cues: schedule.timeline.cues.map((c) => ({
      id: c.id,
      at: serveAt + c.offsetMinutes * 60_000,
      recipeId: c.recipeId,
      stepIndex: c.stepIndex,
      dish: c.recipeId ? dish.get(c.recipeId) ?? null : null,
      text: c.text,
      ...(c.covers?.length ? { covers: c.covers } : {}),
    })),
    frozen: isFrozen(schedule.timeline),
  };
}
