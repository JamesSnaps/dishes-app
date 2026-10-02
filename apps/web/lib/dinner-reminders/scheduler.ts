import { db } from "@/lib/db";
import { householdMembers } from "@dishes/db/schema";
import { and, eq } from "drizzle-orm";
import { getRedis } from "@/lib/redis";
import { sendPushToUsers, type PushPayload } from "@/lib/push";
import { describeEstimate } from "./estimate";
import { getDinnerPlan, getReminderSettings, type DinnerPlan } from "./schedule";
import { localNow, minutesToTime, timeToMinutes } from "./time";

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
const SENT_TTL_SECONDS = 36 * 60 * 60;

export const SNOOZE_ACTION = "snooze";
export const SNOOZE_MINUTES = 30;

declare global {
  var __dinnerReminderTimer: NodeJS.Timeout | undefined;
}

// Fallback dedupe when Redis isn't configured. Lost on restart, which at worst
// means one repeat reminder if the container restarts inside the window.
const sentLocally = new Set<string>();

/**
 * Claim the right to send one reminder. The key includes the dinner time, so
 * pushing dinner back (or any one-off change) naturally arms a fresh reminder.
 */
async function claim(key: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.set(key, "1", "EX", SENT_TTL_SECONDS, "NX")) === "OK";
    } catch (err) {
      console.error("[dinner-reminders] redis claim failed, using memory:", err);
    }
  }
  if (sentLocally.has(key)) return false;
  sentLocally.add(key);
  if (sentLocally.size > 500) sentLocally.clear();
  return true;
}

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

async function remindHousehold(householdId: string, users: string[]): Promise<void> {
  const settings = await getReminderSettings(householdId);
  const now = localNow(settings.timezone);
  const plan = await getDinnerPlan(householdId, now.date, settings);

  if (!plan.dinner.reminderEnabled || plan.notifyAt === null) return;
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
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.info("[dinner-reminders] VAPID keys not set — dinner reminders disabled");
    return;
  }

  const tick = () => {
    runDinnerReminderTick().catch((err) =>
      console.error("[dinner-reminders] tick failed:", err)
    );
  };
  globalThis.__dinnerReminderTimer = setInterval(tick, TICK_MS);
  // Don't fire the instant the server boots, while migrations settle.
  setTimeout(tick, 15_000);
  console.info("[dinner-reminders] scheduler started");
}
