import { db } from "@/lib/db";
import { householdMembers } from "@dishes/db/schema";
import { and, eq } from "drizzle-orm";
import { claimReminder } from "@/lib/reminder-claim";
import { pushConfigured, sendPushToUsers, type PushPayload } from "@/lib/push";
import { runLiveActivityTick } from "@/lib/live-activities";
import { describeEstimate } from "./estimate";
import { getDinnerPlan, getReminderSettings, type DinnerPlan } from "./schedule";
import { localNow, minutesToTime, timeToMinutes, weekStartOf } from "./time";
import { schedulesForDate, type MealSchedule } from "@/lib/services/meal-timeline";
import type { TimelineCue } from "@/lib/meal-timeline";

/**
 * In-process dinner reminder loop. Every minute it works out, for each
 * household with someone opted in, whether tonight's "start cooking" reminder
 * is due, and pushes it once.
 *
 * Runs inside the web container (started from `instrumentation.ts`) because
 * Phase 1 has no worker. Everything it does is idempotent per minute, so it
 * can move to the worker's scheduler later unchanged.
 */

const TICK_MS = 60_000;

export const SNOOZE_ACTION = "snooze";
export const SNOOZE_MINUTES = 30;

declare global {
  var __dinnerReminderTimer: NodeJS.Timeout | undefined;
}

/**
 * Claim the right to send one reminder. Keys include the dinner time, so
 * pushing dinner back (or any one-off change) naturally arms a fresh reminder.
 */
const claim = claimReminder;

export function buildReminderPayload(plan: DinnerPlan, nowMinutes: number): PushPayload | null {
  const { lead, startAt, dinner } = plan;
  if (!lead || startAt === null) return null;

  const untilStart = startAt - nowMinutes;
  const how = describeEstimate(lead.estimate);
  const others = plan.dishes.filter((d) => d.recipeId !== lead.recipeId).map((d) => d.title);
  const also = others.length ? ` Also tonight: ${others.join(", ")}.` : "";

  let title: string;
  let body: string;
  if (untilStart > 0) {
    title = `Start ${lead.title} in ${untilStart} min`;
    body = `To eat at ${dinner.time}, start by ${minutesToTime(startAt)}. It ${how}.${also}`;
  } else if (untilStart === 0) {
    title = `Time to start ${lead.title}`;
    body = `Start now to eat at ${dinner.time}. It ${how}.${also}`;
  } else {
    title = `Start ${lead.title} now`;
    body = `You're ${-untilStart} min behind for ${dinner.time}. It ${how}.${also}`;
  }

  return {
    title,
    body,
    url: `/recipes/${lead.recipeId}/cook`,
    tag: `dinner-${plan.date}`,
    actions: [{ action: SNOOZE_ACTION, title: `Push back ${SNOOZE_MINUTES} min` }],
    data: { snoozeDate: plan.date },
  };
}

/** A cue is still worth sending this long after its time (a missed tick, a restart). */
const CUE_WINDOW_MINUTES = 10;

/**
 * Pushes for a scheduled meal: a heads-up before the first step, then each
 * cue as its time comes — "15:05 · Potatoes in — oven up to 200°C". Cues due
 * in the same minute go out as one notification. Each is claimed once per
 * date and serve time, so moving the serve time re-arms the lot.
 */
async function remindMealCues(
  schedule: MealSchedule,
  users: string[],
  householdId: string,
  nowMinutes: number,
  leadMinutes: number
): Promise<void> {
  if (!schedule.serveAt) return;
  const serveMin = timeToMinutes(schedule.serveAt);
  const dishTitle = new Map(schedule.dishes.map((d) => [d.recipeId, d.title]));
  const minuteOf = (cue: TimelineCue) => serveMin + cue.offsetMinutes;
  const keyBase = `mealcue:${schedule.groupId}:${schedule.date}:${schedule.serveAt}`;
  const cookUrl = (recipeId: string | null) => {
    const id = recipeId ?? schedule.dishes[0]?.recipeId;
    return id ? `/recipes/${id}/cook?meal=${schedule.groupId}` : "/meal-plan";
  };
  const line = (cue: TimelineCue) =>
    cue.recipeId ? `${dishTitle.get(cue.recipeId) ?? "Dish"}: ${cue.text}` : cue.text;

  const first = schedule.timeline.cues.find((c) => c.id !== "serve");
  if (first) {
    const firstMin = minuteOf(first);
    const headsUp = firstMin - leadMinutes;
    if (
      firstMin > 0 &&
      nowMinutes >= headsUp &&
      nowMinutes < firstMin &&
      (await claim(`${keyBase}:lead`))
    ) {
      await sendPushToUsers(householdId, users, {
        title: `${schedule.title}: first step at ${minutesToTime(firstMin)}`,
        body: `${line(first)}. Everything ready by ${schedule.serveAt}.`,
        url: cookUrl(first.recipeId),
        tag: `mealcue-${schedule.groupId}-lead`,
      });
    }
  }

  const due: TimelineCue[] = [];
  for (const cue of schedule.timeline.cues) {
    const at = minuteOf(cue);
    if (at < 0 || nowMinutes < at || nowMinutes >= at + CUE_WINDOW_MINUTES) continue;
    if (await claim(`${keyBase}:${cue.id}`)) due.push(cue);
  }
  if (!due.length) return;

  const at = minutesToTime(minuteOf(due[0]!));
  const serving = due.some((c) => c.id === "serve");
  const result = await sendPushToUsers(householdId, users, {
    title: serving ? `${schedule.title} — time to serve` : `${at} · ${line(due[0]!)}`,
    body: serving
      ? "Everything should be ready now."
      : due.length > 1
      ? due.slice(1).map(line).join(" · ")
      : `${schedule.title} — ready by ${schedule.serveAt}`,
    url: cookUrl(due.find((c) => c.recipeId)?.recipeId ?? null),
    tag: `mealcue-${schedule.groupId}-${due[0]!.id}`,
  });
  console.info(
    `[dinner-reminders] meal=${schedule.groupId} cues=${due.map((c) => c.id).join(",")} ` +
      `sent=${result.sent} failed=${result.failed}`
  );
}

async function remindHousehold(householdId: string, users: string[]): Promise<void> {
  const settings = await getReminderSettings(householdId);
  const now = localNow(settings.timezone);
  const plan = await getDinnerPlan(householdId, now.date, settings);

  // The day's "no reminder" switch silences everything for it, schedules too.
  if (!plan.dinner.reminderEnabled) return;

  const schedules = await schedulesForDate(
    householdId,
    now.date,
    weekStartOf(now.date),
    now.dayOfWeek
  );
  for (const schedule of schedules) {
    await remindMealCues(schedule, users, householdId, now.minutes, settings.leadMinutes);
  }

  // A scheduled meal covering all of tonight's dinner has its own, better
  // cues; the single "start cooking" reminder would only repeat the first.
  const scheduled = new Set(schedules.flatMap((s) => s.dishes.map((d) => d.recipeId)));
  if (plan.dishes.length && plan.dishes.every((d) => scheduled.has(d.recipeId))) return;

  if (plan.notifyAt === null) return;
  // Due from the reminder time until dinner itself. After dinner, a late
  // reminder (say the container was down) would just be noise.
  if (now.minutes < plan.notifyAt || now.minutes >= timeToMinutes(plan.dinner.time)) return;

  if (!(await claim(`dinnerrem:${householdId}:${now.date}:${plan.dinner.time}`))) return;

  const payload = buildReminderPayload(plan, now.minutes);
  if (!payload) return;
  const result = await sendPushToUsers(householdId, users, payload);
  console.info(
    `[dinner-reminders] household=${householdId} dinner=${plan.dinner.time} ` +
      `recipe="${plan.lead?.title}" sent=${result.sent} failed=${result.failed}`
  );
}

export async function runDinnerReminderTick(): Promise<void> {
  const members = await db
    .select({ householdId: householdMembers.householdId, user: householdMembers.autheliaUser })
    .from(householdMembers)
    .where(and(eq(householdMembers.dinnerReminders, true), eq(householdMembers.isActive, true)));

  const byHousehold = new Map<string, string[]>();
  for (const m of members) {
    byHousehold.set(m.householdId, [...(byHousehold.get(m.householdId) ?? []), m.user]);
  }

  for (const [householdId, users] of byHousehold) {
    try {
      await remindHousehold(householdId, users);
    } catch (err) {
      console.error(`[dinner-reminders] household=${householdId} failed:`, err);
    }
  }
}

export function startDinnerReminderScheduler(): void {
  if (globalThis.__dinnerReminderTimer) return;
  if (!pushConfigured()) {
    console.info("[dinner-reminders] no push configured (VAPID or APNs) — dinner reminders disabled");
    return;
  }

  const tick = () => {
    runDinnerReminderTick().catch((err) =>
      console.error("[dinner-reminders] tick failed:", err)
    );
    runLiveActivityTick().catch((err) =>
      console.error("[live-activities] tick failed:", err)
    );
  };
  globalThis.__dinnerReminderTimer = setInterval(tick, TICK_MS);
  // Don't fire the instant the server boots, while migrations settle.
  setTimeout(tick, 15_000);
  console.info("[dinner-reminders] scheduler started");
}
