/**
 * Cooking schedules for planned meals: the serve-by time, the schedule itself
 * (simple, or AI-planned and stored), and the per-day lookup the push
 * scheduler uses to send each cue on time.
 *
 * The schedule logic is in `lib/meal-timeline.ts`; this module is the data and
 * AI side of it. Every read is household-scoped through the group's plan.
 */

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { db } from "@/lib/db";
import { aiConfigurations, mealPlanGroups, mealPlans } from "@dishes/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { maxTokensParam } from "@/lib/ai/recipe-generation";
import type { HouseholdContext } from "@/lib/session";
import { getGroupForCooking, MealPlanValidationError } from "@/lib/services/meal-plan";
import {
  getReminderSettings,
  getWeekDinnerSettings,
  setDayDinner,
} from "@/lib/dinner-reminders/schedule";
import {
  addDaysToDate,
  dayOfWeekOf,
  isValidTime,
  localNow,
  minutesToTime,
  timeToMinutes,
  weekStartOf,
} from "@/lib/dinner-reminders/time";
import { claimReminder } from "@/lib/reminder-claim";
import {
  autoTimeline,
  parseStoredTimeline,
  reconcileTimeline,
  timelineInputsKey,
  type MealTimeline,
  type TimelineDishInput,
} from "@/lib/meal-timeline";

export type MealSchedule = {
  groupId: string;
  title: string;
  /** The planned date, "YYYY-MM-DD". */
  date: string;
  /** "HH:MM" to be ready by, or null when none is set (non-dinner meals). */
  serveAt: string | null;
  /** Where the serve time came from: set on the meal, or the day's dinner time. */
  serveAtSource: "meal" | "dinner" | null;
  timeline: MealTimeline;
  /** An AI schedule exists but the dishes have changed since it was planned. */
  aiStale: boolean;
  /** The household has an AI key, so "plan with AI" can be offered. */
  aiConfigured: boolean;
  dishes: { recipeId: string; title: string }[];
};

async function loadGroup(ctx: HouseholdContext, groupId: string) {
  const [group] = await db
    .select({
      id: mealPlanGroups.id,
      title: mealPlanGroups.title,
      dayOfWeek: mealPlanGroups.dayOfWeek,
      mealType: mealPlanGroups.mealType,
      serveAt: mealPlanGroups.serveAt,
      timeline: mealPlanGroups.timeline,
      weekStartDate: mealPlans.weekStartDate,
    })
    .from(mealPlanGroups)
    .innerJoin(mealPlans, eq(mealPlanGroups.mealPlanId, mealPlans.id))
    .where(and(eq(mealPlanGroups.id, groupId), eq(mealPlans.householdId, ctx.householdId)))
    .limit(1);
  if (!group) throw new MealPlanValidationError("Meal not found");
  return group;
}

async function aiConfigFor(householdId: string) {
  const [config] = await db
    .select({ encryptedApiKey: aiConfigurations.encryptedApiKey, model: aiConfigurations.model })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);
  return config ?? null;
}

/** The meal's own time, else the day's dinner time for a dinner, else none. */
async function resolveServeAt(
  householdId: string,
  group: Awaited<ReturnType<typeof loadGroup>>
): Promise<{ serveAt: string | null; source: MealSchedule["serveAtSource"] }> {
  if (group.serveAt && isValidTime(group.serveAt)) return { serveAt: group.serveAt, source: "meal" };
  if (group.mealType !== "dinner") return { serveAt: null, source: null };
  const week = await getWeekDinnerSettings(householdId, group.weekStartDate);
  return { serveAt: week[group.dayOfWeek]?.time ?? null, source: "dinner" };
}

/**
 * The schedule to use: the stored AI one while it still matches the dishes,
 * otherwise the simple one worked out now.
 */
function chooseTimeline(stored: unknown, dishes: TimelineDishInput[]) {
  const saved = parseStoredTimeline(stored);
  const current = timelineInputsKey(dishes);
  if (saved && saved.inputsKey === current) return { timeline: saved, aiStale: false };
  return { timeline: autoTimeline(dishes), aiStale: saved?.source === "ai" };
}

export async function getMealSchedule(
  ctx: HouseholdContext,
  groupId: string
): Promise<MealSchedule> {
  const group = await loadGroup(ctx, groupId);
  const [{ dishes }, serve, ai] = await Promise.all([
    getGroupForCooking(ctx, groupId),
    resolveServeAt(ctx.householdId, group),
    aiConfigFor(ctx.householdId),
  ]);
  const { timeline, aiStale } = chooseTimeline(group.timeline, dishes);

  return {
    groupId: group.id,
    title: group.title,
    date: addDaysToDate(group.weekStartDate, group.dayOfWeek),
    serveAt: serve.serveAt,
    serveAtSource: serve.source,
    timeline,
    aiStale,
    aiConfigured: !!ai,
    dishes: dishes.map((d) => ({ recipeId: d.recipeId, title: d.title })),
  };
}

/** Set (or clear, with null) the time this meal should be ready by. */
export async function setMealServeAt(
  ctx: HouseholdContext,
  groupId: string,
  serveAt: string | null
): Promise<void> {
  if (serveAt !== null && !isValidTime(serveAt)) {
    throw new MealPlanValidationError("Use a time like 16:00");
  }
  await loadGroup(ctx, groupId);
  await db.update(mealPlanGroups).set({ serveAt }).where(eq(mealPlanGroups.id, groupId));
}

/**
 * Move the meal's serve time by `minutes` — cooking mode's "I started earlier
 * (or later), move dinner". Whichever time the meal follows moves: its own
 * serve-at, or for a dinner on the day's time, that date's dinner time, so the
 * planner's dinner chip moves with it. Every cue, push and Live Activity reads
 * from that, so they all follow.
 *
 * Cues that are already due at the new time are marked sent: you're doing (or
 * did) them, and the reminder loop would otherwise send them again because
 * moving the time re-arms every cue.
 */
export async function shiftMealServeAt(
  ctx: HouseholdContext,
  groupId: string,
  minutes: number
): Promise<MealSchedule> {
  if (!Number.isInteger(minutes) || Math.abs(minutes) > 12 * 60) {
    throw new MealPlanValidationError("That's too far to move the meal.");
  }
  const before = await getMealSchedule(ctx, groupId);
  if (!before.serveAt) throw new MealPlanValidationError("This meal has no ready-by time to move.");
  const target = timeToMinutes(before.serveAt) + minutes;
  if (target < 0 || target >= 24 * 60) {
    throw new MealPlanValidationError("That would move the meal into another day.");
  }
  const serveAt = minutesToTime(target);

  if (before.serveAtSource === "dinner") {
    const week = await getWeekDinnerSettings(ctx.householdId, weekStartOf(before.date));
    const day = week[dayOfWeekOf(before.date)];
    // Back on the usual time is no one-off at all.
    await setDayDinner(ctx, before.date, { dinnerTime: serveAt === day?.defaultTime ? null : serveAt });
  } else {
    await setMealServeAt(ctx, groupId, serveAt);
  }

  const after = await getMealSchedule(ctx, groupId);
  await markPassedCuesSent(ctx.householdId, after);
  return after;
}

/** The claim key the reminder loop uses for a meal's cues at its serve time. */
export function mealCueKeyBase(schedule: Pick<MealSchedule, "groupId" | "date" | "serveAt">): string {
  return `mealcue:${schedule.groupId}:${schedule.date}:${schedule.serveAt}`;
}

async function markPassedCuesSent(householdId: string, schedule: MealSchedule): Promise<void> {
  if (!schedule.serveAt) return;
  const now = localNow((await getReminderSettings(householdId)).timezone);
  if (now.date !== schedule.date) return;
  const serveMin = timeToMinutes(schedule.serveAt);
  const base = mealCueKeyBase(schedule);
  for (const cue of schedule.timeline.cues) {
    if (serveMin + cue.offsetMinutes <= now.minutes) await claimReminder(`${base}:${cue.id}`);
  }
}

/** Drop a stored AI schedule; the simple one takes over. */
export async function clearMealTimeline(ctx: HouseholdContext, groupId: string): Promise<void> {
  await loadGroup(ctx, groupId);
  await db.update(mealPlanGroups).set({ timeline: null }).where(eq(mealPlanGroups.id, groupId));
}

// --- AI planning ------------------------------------------------------------

const aiScheduleSchema = z.object({
  cues: z.array(
    z.object({
      offsetMinutes: z.number(),
      recipeId: z.string().nullable(),
      stepIndex: z.number().int().nullable(),
      text: z.string(),
    })
  ),
  warnings: z.array(z.string()),
});

const SYSTEM_PROMPT = `You plan the timing of a home-cooked meal with several dishes so that everything is ready to serve at the same moment.

You are given each dish's steps, in order, with the minutes each takes (null = not stated; assume a sensible amount from the instruction). Produce cues measured in minutes before serving: offsetMinutes is negative (−90 = ninety minutes before serving) and 0 is serving.

Rules:
- Include every step of every dish exactly once, as a cue with that dish's recipeId and the step's stepIndex. Keep each dish's steps in their order.
- A step may start before the previous step of the same dish has finished only when that previous step is hands-off (roasting, baking, simmering, resting, marinating), and only for preparation that doesn't need it finished.
- There is one cook and one oven. Avoid two hands-on tasks at the same time where you can. If dishes need different oven temperatures, sequence them or adjust the temperature and add a short note cue when it changes ("Oven up to 220°C").
- Put food that must rest (roast meat) out of the oven early enough to rest, and use resting time for other work. Keep hot things hot: finish quick vegetables and gravy close to serving.
- Note cues are extra coordination only: recipeId may be a dish or null, stepIndex null.
- Cue text is short and imperative, under 80 characters, in the cook's words: "Potatoes in — oven up to 200°C", "Chicken out to rest".
- warnings: one sentence each for real problems you could not avoid (an oven clash, a dish that can't be held). Empty if none.`;

/**
 * Plan the schedule with the household's AI and store it. Falls back to
 * nothing: a failure throws a readable error and the simple schedule stays.
 */
export async function planMealTimelineWithAi(
  ctx: HouseholdContext,
  groupId: string
): Promise<MealTimeline> {
  const group = await loadGroup(ctx, groupId);
  const config = await aiConfigFor(ctx.householdId);
  if (!config) throw new MealPlanValidationError("AI isn't set up — add a key in Settings → AI.");

  const { dishes } = await getGroupForCooking(ctx, groupId);
  if (!dishes.length) throw new MealPlanValidationError("None of these dishes has steps to plan.");

  const serve = await resolveServeAt(ctx.householdId, group);
  const brief = {
    meal: group.title,
    serveAt: serve.serveAt,
    dishes: dishes.map((d) => ({
      recipeId: d.recipeId,
      title: d.title,
      role: d.role,
      steps: d.steps.map((s, i) => ({
        stepIndex: i,
        minutes: s.durationMinutes,
        instruction: s.instruction,
      })),
    })),
  };

  const client = new OpenAI({ apiKey: decrypt(config.encryptedApiKey), fetch: globalThis.fetch });
  let parsed: z.infer<typeof aiScheduleSchema>;
  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      response_format: zodResponseFormat(aiScheduleSchema, "meal_schedule"),
      ...maxTokensParam(config.model, 4000),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(brief) },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("empty response");
    parsed = aiScheduleSchema.parse(JSON.parse(raw));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[meal-timeline] AI planning failed group=${groupId}:`, msg);
    throw new MealPlanValidationError(
      /api key|401/i.test(msg)
        ? "The AI key was rejected — check Settings → AI."
        : /429|quota|rate/i.test(msg)
        ? "The AI is rate limited right now. Try again shortly."
        : "The AI couldn't plan this meal. The simple schedule is still there."
    );
  }

  const timeline = reconcileTimeline(parsed.cues, parsed.warnings, dishes);
  await db
    .update(mealPlanGroups)
    .set({ timeline })
    .where(eq(mealPlanGroups.id, groupId));
  return timeline;
}

// --- For the push scheduler -------------------------------------------------

/**
 * Every planned meal on a date that has a serve time, with its schedule. Used
 * by the reminder loop, which has no session — hence a household id rather
 * than a context with a member.
 */
export async function schedulesForDate(
  householdId: string,
  date: string,
  weekStartDate: string,
  dayOfWeek: number
): Promise<MealSchedule[]> {
  const groups = await db
    .select({ id: mealPlanGroups.id })
    .from(mealPlanGroups)
    .innerJoin(mealPlans, eq(mealPlanGroups.mealPlanId, mealPlans.id))
    .where(
      and(
        eq(mealPlans.householdId, householdId),
        eq(mealPlans.weekStartDate, weekStartDate),
        eq(mealPlanGroups.dayOfWeek, dayOfWeek)
      )
    );

  const ctx = { householdId, memberId: "" };
  const out: MealSchedule[] = [];
  for (const g of groups) {
    const schedule = await getMealSchedule(ctx, g.id);
    if (schedule.serveAt && schedule.date === date) out.push(schedule);
  }
  return out;
}
