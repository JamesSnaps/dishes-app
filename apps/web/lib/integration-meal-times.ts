import {
  getDinnerPlan,
  getReminderSettings,
  getWeekDinnerSettings,
  type ReminderSettings,
} from "@/lib/dinner-reminders/schedule";
import {
  addDaysToDate,
  isValidTime,
  localNow,
  minutesToTime,
  weekStartOf,
  zonedEpoch,
} from "@/lib/dinner-reminders/time";
import { schedulesForDate } from "@/lib/services/meal-timeline";

/**
 * The household's clock for the integration routes. "Today" and "this week"
 * are the kitchen's, in the household timezone: the server runs in UTC, which
 * put the first hour after midnight in British summer time on the day before
 * (and, on a Monday, in the week before).
 */
export async function householdClock(householdId: string) {
  const settings = await getReminderSettings(householdId);
  const now = localNow(settings.timezone);
  return {
    settings,
    timezone: settings.timezone,
    today: now.date,
    dayOfWeek: now.dayOfWeek,
    weekStartDate: weekStartOf(now.date),
  };
}

/** What the routes select to work out an entry's serve time. */
export type ServeTimeInput = { dayOfWeek: number; mealType: string; groupServeAt: string | null };

/**
 * Serve times for one week's entries as ISO instants: the meal's own ready-by
 * time, else the day's dinner time for dinner, else null — the rule the meal
 * timeline uses (services/meal-timeline.ts resolveServeAt).
 */
export async function weekServeTimes(
  householdId: string,
  weekStartDate: string,
  settings: ReminderSettings
): Promise<(entry: ServeTimeInput) => string | null> {
  const days = await getWeekDinnerSettings(householdId, weekStartDate, settings);
  return ({ dayOfWeek, mealType, groupServeAt }) => {
    const time =
      groupServeAt && isValidTime(groupServeAt)
        ? groupServeAt
        : mealType === "dinner"
          ? (days[dayOfWeek]?.time ?? null)
          : null;
    if (!time) return null;
    const date = addDaysToDate(weekStartDate, dayOfWeek);
    return new Date(zonedEpoch(date, time, settings.timezone)).toISOString();
  };
}

/**
 * Today's dinner on the household clock: when it's served and when to start
 * cooking it. The start is what the reminders go by (dinner-reminders/
 * scheduler.ts): a cooking schedule's first step for the dishes it covers,
 * and the cook-time estimate for any it doesn't — whichever is earlier.
 */
export async function todayDinner(
  householdId: string,
  clock: Awaited<ReturnType<typeof householdClock>>
) {
  const [plan, schedules] = await Promise.all([
    getDinnerPlan(householdId, clock.today, clock.settings),
    schedulesForDate(householdId, clock.today, clock.weekStartDate, clock.dayOfWeek),
  ]);
  const at = (time: string) => zonedEpoch(clock.today, time, clock.timezone);

  const dinnerIds = new Set(plan.dishes.map((d) => d.recipeId));
  const covered = new Set<string>();
  const starts: number[] = [];
  for (const schedule of schedules) {
    if (!schedule.serveAt || !schedule.dishes.some((d) => dinnerIds.has(d.recipeId))) continue;
    schedule.dishes.forEach((d) => covered.add(d.recipeId));
    const first = Math.min(0, ...schedule.timeline.cues.map((c) => c.offsetMinutes));
    starts.push(at(schedule.serveAt) + first * 60_000);
  }
  if (plan.startAt !== null && plan.dishes.some((d) => !covered.has(d.recipeId))) {
    // A long cook can start before midnight; minutesToTime would wrap it to tonight.
    starts.push(
      plan.startAt >= 0 ? at(minutesToTime(plan.startAt)) : at("00:00") + plan.startAt * 60_000
    );
  }

  // Not cooking tonight (eating out, a takeaway…): nothing to start.
  const cooking = !plan.dinner.notCooking;
  return {
    time: plan.dinner.time,
    serveAt: new Date(at(plan.dinner.time)).toISOString(),
    startCookingAt: cooking && starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    reminderEnabled: plan.dinner.reminderEnabled && cooking,
    /** The outside meal's kind ("eat_out", "takeaway"…) when dinner isn't cooked at home. */
    notCooking: plan.dinner.notCooking,
  };
}
