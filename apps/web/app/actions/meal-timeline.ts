"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import * as timelineService from "@/lib/services/meal-timeline";
import { MealPlanValidationError } from "@/lib/services/meal-plan";

/**
 * Web transport for meal cooking schedules (`lib/services/meal-timeline.ts`).
 * Failures a person can cause, or the AI can, come back as `{ ok: false }`
 * with a readable message so the schedule dialog can show it.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>, revalidate = false): Promise<Result<T>> {
  try {
    const data = await fn();
    if (revalidate) revalidatePath("/meal-plan");
    return { ok: true, data };
  } catch (err) {
    if (err instanceof MealPlanValidationError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function getMealSchedule(groupId: string) {
  const session = await requireSession();
  return run(() => timelineService.getMealSchedule(session, groupId));
}

export async function setMealServeAt(groupId: string, serveAt: string | null) {
  const session = await requireSession();
  return run(async () => {
    await timelineService.setMealServeAt(session, groupId, serveAt);
    return timelineService.getMealSchedule(session, groupId);
  }, true);
}

/** Move the meal's serve time by `minutes` — "I started earlier, move dinner". */
export async function shiftMealServeAt(groupId: string, minutes: number) {
  const session = await requireSession();
  return run(() => timelineService.shiftMealServeAt(session, groupId, minutes), true);
}

export async function planMealTimelineWithAi(groupId: string) {
  const session = await requireSession();
  return run(async () => {
    await timelineService.planMealTimelineWithAi(session, groupId);
    return timelineService.getMealSchedule(session, groupId);
  }, true);
}

export async function clearMealTimeline(groupId: string) {
  const session = await requireSession();
  return run(async () => {
    await timelineService.clearMealTimeline(session, groupId);
    return timelineService.getMealSchedule(session, groupId);
  }, true);
}
