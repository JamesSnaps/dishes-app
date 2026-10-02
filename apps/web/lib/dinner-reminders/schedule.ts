import { db } from "@/lib/db";
import {
  dinnerReminderSettings,
  mealPlanDays,
  mealPlanEntries,
  mealPlans,
  recipes,
  type DinnerReminderSettings,
} from "@dishes/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  DEFAULT_DINNER_TIME,
  DEFAULT_LEAD_MINUTES,
  DEFAULT_TIMEZONE,
  dayOfWeekOf,
  isValidTime,
  minutesToTime,
  timeToMinutes,
  weekStartOf,
} from "./time";
import { estimateCookTimes, type CookEstimate } from "./estimate";

/**
 * Dinner-time resolution and the "when should we start cooking" plan.
 *
 * Most specific wins: a one-off time on the planned day, then the weekday
 * default, then the household default.
 */

export type ReminderSettings = Pick<
  DinnerReminderSettings,
  "dinnerTime" | "dayTimes" | "leadMinutes" | "timezone"
>;

export const DEFAULT_SETTINGS: ReminderSettings = {
  dinnerTime: DEFAULT_DINNER_TIME,
  dayTimes: {},
  leadMinutes: DEFAULT_LEAD_MINUTES,
  timezone: DEFAULT_TIMEZONE,
};

export async function getReminderSettings(householdId: string): Promise<ReminderSettings> {
  const [row] = await db
    .select()
    .from(dinnerReminderSettings)
    .where(eq(dinnerReminderSettings.householdId, householdId))
    .limit(1);
  return row ?? DEFAULT_SETTINGS;
}

/** The dinner time a weekday gets when nothing has been set for the date. */
export function defaultTimeForDay(settings: ReminderSettings, dayOfWeek: number): string {
  const perDay = settings.dayTimes[String(dayOfWeek)];
  return perDay && isValidTime(perDay) ? perDay : settings.dinnerTime;
}

export interface DayDinnerSetting {
  dayOfWeek: number;
  /** Effective dinner time for the day. */
  time: string;
  /** The time the day would have without a one-off change. */
  defaultTime: string;
  /** A one-off time is set for this date. */
  overridden: boolean;
  reminderEnabled: boolean;
}

export interface WeekDinnerSchedule {
  days: DayDinnerSetting[];
  /** Real-world minutes per recipe, for "start by" on the planner. */
  estimates: Record<string, { minutes: number; explanation: string }>;
}

/** One-off rows for a week, keyed by day. Empty when the week has no plan. */
async function weekDayRows(householdId: string, weekStartDate: string) {
  const rows = await db
    .select({
      dayOfWeek: mealPlanDays.dayOfWeek,
      dinnerTime: mealPlanDays.dinnerTime,
      reminderEnabled: mealPlanDays.reminderEnabled,
    })
    .from(mealPlanDays)
    .innerJoin(mealPlans, eq(mealPlanDays.mealPlanId, mealPlans.id))
    .where(
      and(eq(mealPlans.householdId, householdId), eq(mealPlans.weekStartDate, weekStartDate))
    );
  return new Map(rows.map((r) => [r.dayOfWeek, r]));
}

export async function getWeekDinnerSettings(
  householdId: string,
  weekStartDate: string,
  settings?: ReminderSettings
): Promise<DayDinnerSetting[]> {
  const [s, rows] = await Promise.all([
    settings ?? getReminderSettings(householdId),
    weekDayRows(householdId, weekStartDate),
  ]);
  return Array.from({ length: 7 }, (_, day) => {
    const row = rows.get(day);
    const defaultTime = defaultTimeForDay(s, day);
    const override = row?.dinnerTime && isValidTime(row.dinnerTime) ? row.dinnerTime : null;
    return {
      dayOfWeek: day,
      time: override ?? defaultTime,
      defaultTime,
      overridden: override !== null,
      reminderEnabled: row?.reminderEnabled ?? true,
    };
  });
}

/**
 * Write a one-off change for one date. `dinnerTime: null` reverts to the
 * default; the row is dropped entirely once it holds nothing non-default.
 * Creates the week's plan row if the week has never been planned.
 */
export async function setDayDinner(
  ctx: { householdId: string; memberId: string },
  date: string,
  change: { dinnerTime?: string | null; reminderEnabled?: boolean }
): Promise<DayDinnerSetting> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD");
  if (change.dinnerTime != null && !isValidTime(change.dinnerTime)) {
    throw new Error("Dinner time must be HH:MM");
  }
  const weekStartDate = weekStartOf(date);
  const dayOfWeek = dayOfWeekOf(date);

  const [plan] = await db
    .insert(mealPlans)
    .values({
      householdId: ctx.householdId,
      createdById: ctx.memberId,
      weekStartDate,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [mealPlans.householdId, mealPlans.weekStartDate],
      set: { updatedAt: sql`now()` },
    })
    .returning({ id: mealPlans.id });

  const [existing] = await db
    .select()
    .from(mealPlanDays)
    .where(and(eq(mealPlanDays.mealPlanId, plan!.id), eq(mealPlanDays.dayOfWeek, dayOfWeek)))
    .limit(1);

  const next = {
    dinnerTime: change.dinnerTime !== undefined ? change.dinnerTime : existing?.dinnerTime ?? null,
    reminderEnabled: change.reminderEnabled ?? existing?.reminderEnabled ?? true,
  };

  if (next.dinnerTime === null && next.reminderEnabled) {
    if (existing) await db.delete(mealPlanDays).where(eq(mealPlanDays.id, existing.id));
  } else {
    await db
      .insert(mealPlanDays)
      .values({ mealPlanId: plan!.id, dayOfWeek, ...next })
      .onConflictDoUpdate({
        target: [mealPlanDays.mealPlanId, mealPlanDays.dayOfWeek],
        set: next,
      });
  }

  const week = await getWeekDinnerSettings(ctx.householdId, weekStartDate);
  return week[dayOfWeek]!;
}

export interface DinnerPlan {
  date: string;
  dinner: DayDinnerSetting;
  /** Tonight's dinner recipes; the longest one sets the start time. */
  dishes: { recipeId: string; title: string; estimate: CookEstimate }[];
  lead: { recipeId: string; title: string; estimate: CookEstimate } | null;
  /** Minutes since local midnight. */
  startAt: number | null;
  notifyAt: number | null;
  leadMinutes: number;
}

/** Everything the reminder needs to know about one date's dinner. */
export async function getDinnerPlan(
  householdId: string,
  date: string,
  settings?: ReminderSettings
): Promise<DinnerPlan> {
  const s = settings ?? (await getReminderSettings(householdId));
  const weekStartDate = weekStartOf(date);
  const dayOfWeek = dayOfWeekOf(date);

  const [week, entries] = await Promise.all([
    getWeekDinnerSettings(householdId, weekStartDate, s),
    db
      .select({ recipeId: recipes.id, title: recipes.title })
      .from(mealPlanEntries)
      .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          eq(mealPlans.householdId, householdId),
          eq(mealPlans.weekStartDate, weekStartDate),
          eq(mealPlanEntries.dayOfWeek, dayOfWeek),
          eq(mealPlanEntries.mealType, "dinner")
        )
      ),
  ]);

  const estimates = await estimateCookTimes(
    householdId,
    entries.map((e) => e.recipeId)
  );
  const dishes = entries.flatMap((e) => {
    const estimate = estimates.get(e.recipeId);
    return estimate ? [{ ...e, estimate }] : [];
  });
  const lead = dishes.reduce<DinnerPlan["lead"]>(
    (best, d) => (!best || d.estimate.minutes > best.estimate.minutes ? d : best),
    null
  );

  const dinner = week[dayOfWeek]!;
  const startAt = lead ? timeToMinutes(dinner.time) - lead.estimate.minutes : null;
  return {
    date,
    dinner,
    dishes,
    lead,
    startAt,
    notifyAt: startAt === null ? null : startAt - s.leadMinutes,
    leadMinutes: s.leadMinutes,
  };
}

export { minutesToTime };
