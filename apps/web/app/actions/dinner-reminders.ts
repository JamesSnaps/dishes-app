"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { dinnerReminderSettings, householdMembers } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/session";
import {
  getDinnerPlan,
  getReminderSettings,
  getWeekDinnerSettings,
  setDayDinner,
  type WeekDinnerSchedule,
} from "@/lib/dinner-reminders/schedule";
import { describeEstimate, estimateCookTimes } from "@/lib/dinner-reminders/estimate";
import {
  isValidTime,
  isValidTimezone,
  localNow,
  minutesToTime,
} from "@/lib/dinner-reminders/time";

// ─── Settings page ───────────────────────────────────────────────────────────

export async function getDinnerReminderOverview() {
  const session = await requireSession();
  const settings = await getReminderSettings(session.householdId);
  const [me] = await db
    .select({ dinnerReminders: householdMembers.dinnerReminders })
    .from(householdMembers)
    .where(eq(householdMembers.id, session.memberId))
    .limit(1);

  const now = localNow(settings.timezone);
  const plan = await getDinnerPlan(session.householdId, now.date, settings);

  return {
    settings: {
      dinnerTime: settings.dinnerTime,
      dayTimes: settings.dayTimes,
      leadMinutes: settings.leadMinutes,
      timezone: settings.timezone,
    },
    optedIn: me?.dinnerReminders ?? false,
    isAdmin: session.role === "admin",
    tonight: {
      dinnerTime: plan.dinner.time,
      overridden: plan.dinner.overridden,
      reminderEnabled: plan.dinner.reminderEnabled,
      dishes: plan.dishes.map((d) => ({ title: d.title, minutes: d.estimate.minutes })),
      lead: plan.lead
        ? { title: plan.lead.title, explanation: describeEstimate(plan.lead.estimate) }
        : null,
      startAt: plan.startAt === null ? null : minutesToTime(plan.startAt),
      notifyAt: plan.notifyAt === null ? null : minutesToTime(plan.notifyAt),
    },
  };
}

export async function setMyDinnerReminders(enabled: boolean) {
  const session = await requireSession();
  await db
    .update(householdMembers)
    .set({ dinnerReminders: enabled })
    .where(eq(householdMembers.id, session.memberId));
  revalidatePath("/settings/dinner-reminders");
}

export async function saveDinnerReminderSettings(input: {
  dinnerTime: string;
  dayTimes: Record<string, string>;
  leadMinutes: number;
  timezone: string;
}) {
  const session = await requireSession();
  if (session.role !== "admin") throw new Error("Only admins can change dinner times");

  if (!isValidTime(input.dinnerTime)) throw new Error("Dinner time must be HH:MM");
  if (!isValidTimezone(input.timezone)) throw new Error("Unknown timezone");
  const leadMinutes = Math.round(input.leadMinutes);
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0 || leadMinutes > 120) {
    throw new Error("Reminder lead must be 0–120 minutes");
  }
  const dayTimes: Record<string, string> = {};
  for (const [day, time] of Object.entries(input.dayTimes)) {
    if (!/^[0-6]$/.test(day) || !time) continue;
    if (!isValidTime(time)) throw new Error("Day times must be HH:MM");
    dayTimes[day] = time;
  }

  const values = {
    dinnerTime: input.dinnerTime,
    dayTimes,
    leadMinutes,
    timezone: input.timezone,
  };
  await db
    .insert(dinnerReminderSettings)
    .values({ householdId: session.householdId, ...values })
    .onConflictDoUpdate({ target: dinnerReminderSettings.householdId, set: values });

  revalidatePath("/settings/dinner-reminders");
  revalidatePath("/meal-plan");
}

// ─── Meal planner ────────────────────────────────────────────────────────────

export async function getWeekDinnerSchedule(
  weekStartDate: string,
  recipeIds: string[]
): Promise<WeekDinnerSchedule> {
  const session = await requireSession();
  const [days, estimates] = await Promise.all([
    getWeekDinnerSettings(session.householdId, weekStartDate),
    estimateCookTimes(session.householdId, recipeIds.slice(0, 50)),
  ]);
  return {
    days,
    estimates: Object.fromEntries(
      [...estimates].map(([id, e]) => [id, { minutes: e.minutes, explanation: describeEstimate(e) }])
    ),
  };
}

/** One-off change for a single date. `dinnerTime: null` = back to the default. */
export async function setDayDinnerTime(date: string, dinnerTime: string | null) {
  const session = await requireSession();
  return setDayDinner(session, date, { dinnerTime });
}

export async function setDayDinnerReminder(date: string, enabled: boolean) {
  const session = await requireSession();
  return setDayDinner(session, date, { reminderEnabled: enabled });
}
