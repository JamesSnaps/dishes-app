import { db } from "@/lib/db";
import { deliverySettings, householdMembers } from "@dishes/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { claimReminder } from "@/lib/reminder-claim";
import { pushConfigured, sendPushToUsers, usersWanting, type PushPayload } from "@/lib/push";
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
  formatPounds,
  getDeliveryConfig,
  getNextOpenDelivery,
  isBelowMinimum,
  getDeliveryReport,
  listDays,
  weekdayName,
  type DeliveryConfig,
  type DeliveryReport,
} from "./schedule";
import { shortDate } from "./dates";

/**
 * In-process grocery delivery reminder loop. On the day an order closes, at
 * each of the household's reminder times, it pushes whatever is still
 * outstanding: dinners not planned, meals not on the list, items not in the
 * basket — or, once the order is placed, items added since that need an amend
 * and a total under the household's minimum order. A placed order with nothing
 * to flag gets no push, except at the last reminder: that always goes, as a
 * "last orders" nudge with the order's slot and total.
 *
 * Days earlier (`bookingReminderDays` before the delivery) there's one more:
 * if no order has been logged by then, a nudge to book a slot before they go.
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
  opts: { today: string; last: boolean; minOrderTotal?: number | null }
): PushPayload | null {
  const { delivery, checklist } = report;
  const day = weekdayName(delivery.date);
  const closes = describeCutoff(delivery, opts.today);
  const tag = `delivery-${delivery.date}`;

  if (delivery.status === "ordered") {
    const added = checklist.addedSinceOrder;
    const min = opts.minOrderTotal ?? null;
    const low = isBelowMinimum(delivery, min);
    const issues: string[] = [];
    if (low) {
      issues.push(`£${delivery.total} is under your ${formatPounds(min!)} minimum`);
    }
    if (added.length) {
      issues.push(`${plural(added.length, "item")} added since you ordered: ${nameList(added)}`);
    }

    // Placed and nothing to flag: only the last reminder goes, as a nudge.
    if (!issues.length && !opts.last) return null;

    const details = [delivery.slot, delivery.total ? `£${delivery.total}` : null]
      .filter(Boolean)
      .join(" · ");
    return {
      title: issues.length
        ? `${opts.last ? "Last orders: amend" : "Amend"} ${day}'s order by ${closes}`
        : `Last orders soon: ${day}'s order closes ${closes}`,
      body: issues.length
        ? issues.join(" · ")
        : `Ordered${details ? ` · ${details}` : ""}. Nothing to change, unless you've remembered something.`,
      url: added.length ? "/shopping" : "/settings/deliveries",
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

/**
 * The booking reminder goes at the household's first reminder time of the
 * day: that time, if it's due now (recently passed).
 */
export function dueBookingTime(
  config: Pick<DeliveryConfig, "reminderTimes">,
  nowMinutes: number
): string | null {
  const first = config.reminderTimes.filter(isValidTime).sort()[0] ?? "09:00";
  const since = nowMinutes - timeToMinutes(first);
  return since >= 0 && since < LATE_MINUTES ? first : null;
}

/** "Book Thursday's delivery": no order logged yet, a few days out. Null once ordered or skipped. */
export function buildBookingReminder(
  report: DeliveryReport,
  opts: { today: string }
): PushPayload | null {
  const { delivery, checklist } = report;
  if (delivery.status !== "scheduled") return null;
  const day = weekdayName(delivery.date);
  const gaps = checklist.unplannedDinners.length;
  return {
    title: `Book ${day}'s delivery`,
    body:
      `No order logged for ${shortDate(delivery.date)} yet — book a slot before they go. ` +
      `Orders close ${describeCutoff(delivery, opts.today)}.` +
      (gaps ? ` ${plural(gaps, "dinner")} still to plan.` : ""),
    url: "/settings/deliveries",
    tag: `delivery-${delivery.date}`,
    actions: [{ action: DELIVERY_ORDERED_ACTION, title: "Mark as ordered" }],
    data: { deliveryDate: delivery.date },
  };
}

async function remindToBook(householdId: string): Promise<void> {
  const config = await getDeliveryConfig(householdId);
  // Within the deadline reminders' reach, those cover it.
  if (config.bookingReminderDays <= config.cutoffDaysBefore) return;
  const now = localNow(config.timezone);
  const due = dueBookingTime(config, now.minutes);
  if (!due) return;

  const deliveryDate = addDaysToDate(now.date, config.bookingReminderDays);
  const report = await getDeliveryReport(householdId, deliveryDate, config);
  if (!report) return; // no delivery that day
  const payload = buildBookingReminder(report, { today: now.date });
  if (!payload) return; // already ordered, or skipped

  const users = await usersWanting(householdId, "delivery_booking");
  if (!users.length) return;
  if (!(await claimReminder(`delivbook:${householdId}:${deliveryDate}`))) return;
  const result = await sendPushToUsers(householdId, users, payload);
  console.info(
    `[delivery-reminders] booking household=${householdId} delivery=${deliveryDate} ` +
      `sent=${result.sent} failed=${result.failed}`
  );
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
  if (!report) return; // no delivery closes today
  const where = `household=${householdId} delivery=${deliveryDate} at=${due.time}`;
  if (report.delivery.status === "skipped") return;

  if (!(await claimReminder(`delivrem:${householdId}:${deliveryDate}:${due.time}`))) return;

  const payload = buildDeliveryReminder(report, {
    today: now.date,
    last: due.last,
    minOrderTotal: config.minOrderTotal,
  });
  if (!payload) {
    // Logged so "why didn't I get one?" can be answered from the container logs.
    console.info(`[delivery-reminders] ${where} skipped: already ordered, nothing to flag`);
    return;
  }
  const result = await sendPushToUsers(householdId, users, payload);
  console.info(
    `[delivery-reminders] ${where} status=${report.delivery.status} ` +
      `sent=${result.sent} failed=${result.failed}`
  );
}

/**
 * What the last reminder for the next open order would say right now, for the
 * "send a test reminder" button. Null when no order is open.
 */
export async function previewDeliveryReminder(householdId: string): Promise<PushPayload | null> {
  const config = await getDeliveryConfig(householdId);
  const report = await getNextOpenDelivery(householdId, config);
  if (!report) return null;
  const payload = buildDeliveryReminder(report, {
    today: localNow(config.timezone).date,
    last: true,
    minOrderTotal: config.minOrderTotal,
  });
  return payload && { ...payload, title: `Test · ${payload.title}`, tag: `${payload.tag}-test` };
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

  // Booking reminders have their own switch, so every household with them on is checked.
  const booking = await db
    .select({ householdId: deliverySettings.householdId })
    .from(deliverySettings)
    .where(gt(deliverySettings.bookingReminderDays, 0));
  for (const { householdId } of booking) {
    try {
      await remindToBook(householdId);
    } catch (err) {
      console.error(`[delivery-reminders] booking household=${householdId} failed:`, err);
    }
  }
}

export function startDeliveryReminderScheduler(): void {
  if (globalThis.__deliveryReminderTimer) return;
  if (!pushConfigured()) {
    console.info("[delivery-reminders] no push configured (VAPID or APNs) — delivery reminders disabled");
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
