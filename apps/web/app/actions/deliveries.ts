"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  deliverySettings,
  householdMembers,
  type AwayPeriod,
  type DeliveryStatus,
} from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import { requireSession, type Session } from "@/lib/session";
import { saveOrderDetails, type OrderDetailsInput } from "@/lib/deliveries/orders";
import {
  DEFAULT_CUTOFF_DAYS_BEFORE,
  DEFAULT_CUTOFF_TIME,
  DEFAULT_REMINDER_TIMES,
  cutoffEpoch,
  describeCutoff,
  getDeliveryConfig,
  getNextOpenDelivery,
  isValidDate,
  listDays,
  listDeliveries,
  setDeliveryState,
  shortDate,
  weekdayName,
  type DeliveryConfig,
  type DeliveryReport,
  type ResolvedDelivery,
} from "@/lib/deliveries/schedule";
import { addDaysToDate, isValidTime, localNow, weekStartOf } from "@/lib/dinner-reminders/time";

// ─── View models ─────────────────────────────────────────────────────────────

export interface DeliveryDayView {
  date: string;
  label: string;
  status: DeliveryStatus;
  regular: boolean;
  awayLabel: string | null;
  slot: string | null;
  total: string | null;
  orderReference: string | null;
  cutoffLabel: string;
  cutoffPassed: boolean;
}

export interface NextDeliveryView extends DeliveryDayView {
  day: string;
  /** "Mon–Thu" style description of the dates it feeds. */
  coverageLabel: string;
  unplannedDinners: string;
  unplannedCount: number;
  mealsNotOnList: number;
  unticked: number;
  addedSinceOrder: string[];
}

function dayView(
  d: ResolvedDelivery,
  config: DeliveryConfig,
  today: string,
  nowMs: number,
  cutoffAt: (d: ResolvedDelivery) => number
): DeliveryDayView {
  return {
    date: d.date,
    label: shortDate(d.date),
    status: d.status,
    regular: d.regular,
    awayLabel: d.away ? d.away.label || "Away" : null,
    slot: d.slot,
    total: d.total,
    orderReference: d.orderReference,
    cutoffLabel: describeCutoff(d, today),
    cutoffPassed: cutoffAt(d) <= nowMs,
  };
}

function nextView(report: DeliveryReport, config: DeliveryConfig, today: string): NextDeliveryView {
  const { delivery, checklist } = report;
  const coverage = checklist.coverage;
  const first = shortDate(coverage[0]!).split(" ")[0];
  const last = shortDate(coverage[coverage.length - 1]!).split(" ")[0];
  return {
    ...dayView(delivery, config, today, Date.now(), () => report.cutoffAt),
    day: weekdayName(delivery.date),
    coverageLabel: coverage.length > 1 ? `${first}–${last}` : first!,
    unplannedDinners: listDays(checklist.unplannedDinners),
    unplannedCount: checklist.unplannedDinners.length,
    mealsNotOnList: checklist.mealsNotOnList,
    unticked: checklist.unticked,
    addedSinceOrder: checklist.addedSinceOrder,
  };
}

async function viewsFor(householdId: string, from: string, to: string) {
  const config = await getDeliveryConfig(householdId);
  const today = localNow(config.timezone).date;
  const list = await listDeliveries(householdId, from, to, config);
  const now = Date.now();
  return {
    config,
    today,
    days: list.map((d) => dayView(d, config, today, now, (x) => cutoffEpoch(x, config.timezone))),
  };
}

// ─── Settings page ───────────────────────────────────────────────────────────

export async function getDeliveryOverview() {
  const session = await requireSession();
  const config = await getDeliveryConfig(session.householdId);
  const today = localNow(config.timezone).date;
  const [{ days }, next, [me]] = await Promise.all([
    viewsFor(session.householdId, today, addDaysToDate(today, 27)),
    getNextOpenDelivery(session.householdId, config),
    db
      .select({ deliveryReminders: householdMembers.deliveryReminders })
      .from(householdMembers)
      .where(eq(householdMembers.id, session.memberId))
      .limit(1),
  ]);

  return {
    settings: {
      weekdays: config.weekdays,
      cutoffTime: config.cutoffTime,
      cutoffDaysBefore: config.cutoffDaysBefore,
      reminderTimes: config.reminderTimes,
      timezone: config.timezone,
    },
    configured: config.configured,
    awayPeriods: config.awayPeriods.filter((p) => p.to >= today),
    upcoming: days,
    next: next ? nextView(next, config, today) : null,
    optedIn: me?.deliveryReminders ?? false,
    isAdmin: session.role === "admin",
    canEdit: session.role !== "child",
    today,
  };
}

export async function setMyDeliveryReminders(enabled: boolean) {
  const session = await requireSession();
  await db
    .update(householdMembers)
    .set({ deliveryReminders: enabled })
    .where(eq(householdMembers.id, session.memberId));
  revalidatePath("/settings/deliveries");
}

const MAX_REMINDER_TIMES = 6;

export async function saveDeliverySettings(input: {
  weekdays: number[];
  cutoffTime: string;
  cutoffDaysBefore: number;
  reminderTimes: string[];
}) {
  const session = await requireSession();
  if (session.role !== "admin") throw new Error("Only admins can change delivery days");

  const weekdays = [...new Set(input.weekdays)]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  if (!isValidTime(input.cutoffTime)) throw new Error("Order deadline must be HH:MM");
  const cutoffDaysBefore = Math.round(input.cutoffDaysBefore);
  if (!Number.isFinite(cutoffDaysBefore) || cutoffDaysBefore < 0 || cutoffDaysBefore > 3) {
    throw new Error("Order deadline must be 0–3 days before delivery");
  }
  const reminderTimes = [...new Set(input.reminderTimes)].sort();
  if (reminderTimes.some((t) => !isValidTime(t))) throw new Error("Reminder times must be HH:MM");
  if (reminderTimes.some((t) => t >= input.cutoffTime)) {
    throw new Error(`Reminders must be before the ${input.cutoffTime} deadline`);
  }
  if (reminderTimes.length > MAX_REMINDER_TIMES) {
    throw new Error(`At most ${MAX_REMINDER_TIMES} reminder times`);
  }

  const values = { weekdays, cutoffTime: input.cutoffTime, cutoffDaysBefore, reminderTimes };
  await db
    .insert(deliverySettings)
    .values({ householdId: session.householdId, ...values })
    .onConflictDoUpdate({ target: deliverySettings.householdId, set: values });

  revalidatePath("/settings/deliveries");
  revalidatePath("/meal-plan");
}

// ─── Holidays ────────────────────────────────────────────────────────────────

function requireEditor(session: Session) {
  if (session.role === "child") throw new Error("Ask an adult to change deliveries");
}

async function writeAwayPeriods(
  householdId: string,
  change: (current: AwayPeriod[], today: string) => AwayPeriod[]
) {
  const config = await getDeliveryConfig(householdId);
  const today = localNow(config.timezone).date;
  // Holidays that have ended are dropped on every write.
  const awayPeriods = change(config.awayPeriods, today)
    .filter((p) => p.to >= today)
    .sort((a, b) => a.from.localeCompare(b.from));
  await db
    .insert(deliverySettings)
    .values({
      householdId,
      cutoffTime: DEFAULT_CUTOFF_TIME,
      cutoffDaysBefore: DEFAULT_CUTOFF_DAYS_BEFORE,
      reminderTimes: DEFAULT_REMINDER_TIMES,
      awayPeriods,
    })
    .onConflictDoUpdate({ target: deliverySettings.householdId, set: { awayPeriods } });
  revalidatePath("/settings/deliveries");
  revalidatePath("/meal-plan");
}

export async function addAwayPeriod(input: AwayPeriod) {
  const session = await requireSession();
  requireEditor(session);
  if (!isValidDate(input.from) || !isValidDate(input.to)) throw new Error("Pick both dates");
  if (input.to < input.from) throw new Error("The end date is before the start date");
  const label = input.label?.trim().slice(0, 60) || undefined;
  await writeAwayPeriods(session.householdId, (current) => {
    if (current.length >= 20) throw new Error("That's a lot of holidays — remove an old one first");
    return [...current, { from: input.from, to: input.to, ...(label ? { label } : {}) }];
  });
}

export async function removeAwayPeriod(from: string, to: string) {
  const session = await requireSession();
  requireEditor(session);
  await writeAwayPeriods(session.householdId, (current) =>
    current.filter((p) => !(p.from === from && p.to === to))
  );
}

// ─── Per-date changes ────────────────────────────────────────────────────────

/**
 * Change one date: "ordered", "scheduled" (add a one-off / undo a skip or an
 * order), "skipped", or "default" (back to whatever the weekly pattern says).
 */
export async function setDelivery(date: string, target: DeliveryStatus | "default") {
  const session = await requireSession();
  requireEditor(session);
  if (!["ordered", "scheduled", "skipped", "default"].includes(target)) {
    throw new Error("Unknown delivery change");
  }
  await setDeliveryState(session, date, target);
  revalidatePath("/settings/deliveries");
}

/** Save an order's slot, total and order number by hand; marks the date ordered. */
export async function saveDeliveryOrder(date: string, input: OrderDetailsInput) {
  const session = await requireSession();
  requireEditor(session);
  const delivery = await saveOrderDetails(session, date, {
    slot: typeof input.slot === "string" ? input.slot : null,
    total: typeof input.total === "number" ? input.total : null,
    orderReference: typeof input.orderReference === "string" ? input.orderReference : null,
  });
  revalidatePath("/settings/deliveries");
  revalidatePath("/stats");
  return delivery;
}

// ─── Meal planner ────────────────────────────────────────────────────────────

export interface WeekDeliveryPanel {
  configured: boolean;
  canEdit: boolean;
  /** Deliveries on the visible week's dates, skipped ones included. */
  days: DeliveryDayView[];
  /** The next open order, when it's relevant to the visible week. */
  next: NextDeliveryView | null;
}

export async function getWeekDeliveryPanel(weekStartDate: string): Promise<WeekDeliveryPanel> {
  const session = await requireSession();
  if (!isValidDate(weekStartDate)) throw new Error("Week must be YYYY-MM-DD");
  const { config, today, days } = await viewsFor(
    session.householdId,
    weekStartDate,
    addDaysToDate(weekStartDate, 6)
  );
  if (!config.configured && days.length === 0) {
    return { configured: false, canEdit: session.role !== "child", days, next: null };
  }

  const report = await getNextOpenDelivery(session.householdId, config);
  // Show the order card on this week, or on the week whose meals it feeds.
  const relevant =
    report &&
    (weekStartOf(today) === weekStartDate ||
      report.checklist.coverage.some((d) => weekStartOf(d) === weekStartDate));

  return {
    configured: config.configured,
    canEdit: session.role !== "child",
    days,
    next: relevant ? nextView(report, config, today) : null,
  };
}
