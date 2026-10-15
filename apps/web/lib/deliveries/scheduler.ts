import { db } from "@/lib/db";
import { householdMembers } from "@dishes/db/schema";
import { and, eq } from "drizzle-orm";
import { claimReminder } from "@/lib/reminder-claim";
import { sendPushToUsers, type PushPayload } from "@/lib/push";
import {
  addDaysToDate,
  isValidTime,
  localNow,
  minutesToTime,
  timeToMinutes,
  weekStartOf,
} from "@/lib/dinner-reminders/time";
import {
  describeCutoff,
  getDeliveryConfig,
  getDeliveryReport,
  listDays,
  weekdayName,
  type DeliveryConfig,
  type DeliveryReport,
} from "./schedule";

/**
 * In-process grocery delivery reminder loop. On the day an order closes, at
 * each of the household's reminder times, it pushes whatever is still
 * outstanding: dinners not planned, meals not on the list, items not in the
 * basket — or, once the order is placed, items added since that need an amend.
 * Nothing outstanding means no push.
 *
 * Like dinner reminders it runs in the web container until Phase 2's worker,
 * and every send is claimed once per delivery and reminder time.
 */

const TICK_MS = 60_000;
/** A reminder still goes out this long after its time (a missed tick, a restart). */
const LATE_MINUTES = 30;

export const DELIVERY_ORDERED_ACTION = "delivery-ordered";

declare global {
  var __deliveryReminderTimer: NodeJS.Timeout | undefined;
}

/**
 * The reminder due now, if any: the latest reminder time that has passed,
 * provided it's recent and the order hasn't closed. `last` marks the final
 * reminder before the cutoff.
 */
export function dueReminder(
  config: Pick<DeliveryConfig, "cutoffTime" | "reminderTimes">,
  nowMinutes: number
): { time: string; last: boolean } | null {
  const cutoff = timeToMinutes(config.cutoffTime);
  if (nowMinutes >= cutoff) return null;
  const times = config.reminderTimes
    .filter(isValidTime)
    .map(timeToMinutes)
    .filter((t) => t < cutoff)
    .sort((a, b) => a - b);
  let due: number | null = null;
  for (const t of times) if (t <= nowMinutes) due = t;
  if (due === null || nowMinutes - due >= LATE_MINUTES) return null;
  return { time: minutesToTime(due), last: due === times[times.length - 1] };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function nameList(names: string[], max = 4): string {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

export function buildDeliveryReminder(
  report: DeliveryReport,
  opts: { today: string; last: boolean }
): PushPayload | null {
  const { delivery, checklist } = report;
  const day = weekdayName(delivery.date);
  const closes = describeCutoff(delivery, opts.today);
  const tag = `delivery-${delivery.date}`;

  if (delivery.status === "ordered") {
    const added = checklist.addedSinceOrder;
    if (!added.length) return null;
    return {
      title: `${plural(added.length, "item")} added since you ordered`,
      body: `Amend ${day}'s order before ${closes}: ${nameList(added)}`,
      url: "/shopping",
      tag,
    };
  }

  const issues: string[] = [];
  if (checklist.unplannedDinners.length) {
    issues.push(
      `${plural(checklist.unplannedDinners.length, "dinner")} not planned (${listDays(
        checklist.unplannedDinners
      )})`
    );
  }
  if (checklist.mealsNotOnList) {
    issues.push(`${plural(checklist.mealsNotOnList, "planned meal")} not on the list`);
  }
  if (checklist.unticked) {
    issues.push(`${plural(checklist.unticked, "item")} not in the basket yet`);
  }

  const firstGap = checklist.unplannedDinners[0];
  return {
    title: `${opts.last ? "Last call: " : ""}${day}'s delivery — order by ${closes}`,
    body: issues.length
      ? issues.join(" · ")
      : "Meals are planned and the list is done. Just place the order.",
    url: firstGap ? `/meal-plan?week=${weekStartOf(firstGap)}` : "/shopping",
    tag,
    actions: [{ action: DELIVERY_ORDERED_ACTION, title: "Mark as ordered" }],
    data: { deliveryDate: delivery.date },
  };
}

async function remindHousehold(householdId: string, users: string[]): Promise<void> {
  const config = await getDeliveryConfig(householdId);
  const now = localNow(config.timezone);
  const due = dueReminder(config, now.minutes);
  if (!due) return;

  // Orders close a fixed number of days before delivery, so at most one
  // delivery has its deadline today.
  const deliveryDate = addDaysToDate(now.date, config.cutoffDaysBefore);
  const report = await getDeliveryReport(householdId, deliveryDate, config);
  if (!report || report.delivery.status === "skipped") return;

  if (!(await claimReminder(`delivrem:${householdId}:${deliveryDate}:${due.time}`))) return;

  const payload = buildDeliveryReminder(report, { today: now.date, last: due.last });
  if (!payload) return;
  const result = await sendPushToUsers(householdId, users, payload);
  console.info(
    `[delivery-reminders] household=${householdId} delivery=${deliveryDate} at=${due.time} ` +
      `status=${report.delivery.status} sent=${result.sent} failed=${result.failed}`
  );
}

export async function runDeliveryReminderTick(): Promise<void> {
  const members = await db
    .select({ householdId: householdMembers.householdId, user: householdMembers.autheliaUser })
    .from(householdMembers)
    .where(and(eq(householdMembers.deliveryReminders, true), eq(householdMembers.isActive, true)));

  const byHousehold = new Map<string, string[]>();
  for (const m of members) {
    byHousehold.set(m.householdId, [...(byHousehold.get(m.householdId) ?? []), m.user]);
  }

  for (const [householdId, users] of byHousehold) {
    try {
      await remindHousehold(householdId, users);
    } catch (err) {
      console.error(`[delivery-reminders] household=${householdId} failed:`, err);
    }
  }
}

export function startDeliveryReminderScheduler(): void {
  if (globalThis.__deliveryReminderTimer) return;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.info("[delivery-reminders] VAPID keys not set — delivery reminders disabled");
    return;
  }

  const tick = () => {
    runDeliveryReminderTick().catch((err) =>
      console.error("[delivery-reminders] tick failed:", err)
    );
  };
  globalThis.__deliveryReminderTimer = setInterval(tick, TICK_MS);
  setTimeout(tick, 20_000);
  console.info("[delivery-reminders] scheduler started");
}
