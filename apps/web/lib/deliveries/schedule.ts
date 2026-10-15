import { db } from "@/lib/db";
import {
  deliveries,
  deliverySettings,
  mealPlanEntries,
  mealPlans,
  shoppingListItems,
  shoppingLists,
  type AwayPeriod,
  type DeliveryStatus,
} from "@dishes/db/schema";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { HouseholdContext } from "@/lib/session";
import { getReminderSettings } from "@/lib/dinner-reminders/schedule";
import {
  addDaysToDate,
  dayOfWeekOf,
  isValidTime,
  localNow,
  weekStartOf,
  zonedEpoch,
} from "@/lib/dinner-reminders/time";
import { shortDate, weekdayName, weekdayShort } from "./dates";

/**
 * Grocery deliveries: which dates have one, when each order closes, and what
 * still needs doing before it does.
 *
 * A date's status comes from, most specific first: a `deliveries` row for the
 * date, then a holiday covering it (skipped), then the weekly pattern.
 */

export const DEFAULT_CUTOFF_TIME = "23:00";
export const DEFAULT_CUTOFF_DAYS_BEFORE = 1;
export const DEFAULT_REMINDER_TIMES = ["09:00", "19:00", "22:00"];
/** How far a delivery's meals reach when the next delivery is further away. */
const MAX_COVERAGE_DAYS = 7;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export interface DeliveryConfig {
  /** True once the household has saved delivery settings. */
  configured: boolean;
  weekdays: number[];
  cutoffTime: string;
  cutoffDaysBefore: number;
  reminderTimes: string[];
  awayPeriods: AwayPeriod[];
  /** Household timezone, shared with dinner reminders. */
  timezone: string;
}

export async function getDeliveryConfig(householdId: string): Promise<DeliveryConfig> {
  const [[row], dinner] = await Promise.all([
    db
      .select()
      .from(deliverySettings)
      .where(eq(deliverySettings.householdId, householdId))
      .limit(1),
    getReminderSettings(householdId),
  ]);
  return {
    configured: !!row,
    weekdays: row?.weekdays ?? [],
    cutoffTime: row && isValidTime(row.cutoffTime) ? row.cutoffTime : DEFAULT_CUTOFF_TIME,
    cutoffDaysBefore: row?.cutoffDaysBefore ?? DEFAULT_CUTOFF_DAYS_BEFORE,
    reminderTimes: row?.reminderTimes ?? DEFAULT_REMINDER_TIMES,
    awayPeriods: row?.awayPeriods ?? [],
    timezone: dinner.timezone,
  };
}

export function awayOn(config: DeliveryConfig, date: string): AwayPeriod | null {
  return config.awayPeriods.find((p) => p.from <= date && date <= p.to) ?? null;
}

/** What a date would be with no row: the weekly pattern with holidays applied. */
function baseStatus(config: DeliveryConfig, date: string): DeliveryStatus | null {
  if (!config.weekdays.includes(dayOfWeekOf(date))) return null;
  return awayOn(config, date) ? "skipped" : "scheduled";
}

export interface ResolvedDelivery {
  date: string;
  status: DeliveryStatus;
  /** A day from the weekly pattern, as opposed to a one-off. */
  regular: boolean;
  /** The holiday covering this date, if any. */
  away: AwayPeriod | null;
  slot: string | null;
  total: string | null;
  orderReference: string | null;
  orderedAt: Date | null;
  source: string;
  cutoffDate: string;
  cutoffTime: string;
}

/** Every date in [from, to] with a delivery, skipped ones included. */
export async function listDeliveries(
  householdId: string,
  from: string,
  to: string,
  config?: DeliveryConfig
): Promise<ResolvedDelivery[]> {
  const c = config ?? (await getDeliveryConfig(householdId));
  const rows = await db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.householdId, householdId),
        gte(deliveries.deliveryDate, from),
        lte(deliveries.deliveryDate, to)
      )
    );
  const byDate = new Map(rows.map((r) => [r.deliveryDate, r]));

  const out: ResolvedDelivery[] = [];
  for (let date = from; date <= to; date = addDaysToDate(date, 1)) {
    const row = byDate.get(date);
    const base = baseStatus(c, date);
    const status = (row?.status as DeliveryStatus | undefined) ?? base;
    if (!status) continue;
    out.push({
      date,
      status,
      regular: c.weekdays.includes(dayOfWeekOf(date)),
      away: awayOn(c, date),
      slot: row?.slot ?? null,
      total: row?.total ?? null,
      orderReference: row?.orderReference ?? null,
      orderedAt: row?.orderedAt ?? null,
      source: row?.source ?? "manual",
      cutoffDate: addDaysToDate(date, -c.cutoffDaysBefore),
      cutoffTime: c.cutoffTime,
    });
  }
  return out;
}

export function cutoffEpoch(delivery: ResolvedDelivery, timezone: string): number {
  return zonedEpoch(delivery.cutoffDate, delivery.cutoffTime, timezone);
}

/**
 * The dates a delivery has to feed: from its own date up to the day before
 * the next delivery that's actually coming, stopping early at a holiday and
 * never more than a week. `list` must reach a week past the delivery.
 */
export function coverageDates(
  list: ResolvedDelivery[],
  delivery: ResolvedDelivery,
  config: DeliveryConfig
): string[] {
  const coming = new Set(list.filter((d) => d.status !== "skipped").map((d) => d.date));
  const dates = [delivery.date];
  for (let i = 1; i < MAX_COVERAGE_DAYS; i++) {
    const date = addDaysToDate(delivery.date, i);
    if (coming.has(date) || awayOn(config, date)) break;
    dates.push(date);
  }
  return dates;
}

export interface DeliveryChecklist {
  /** Dates in the delivery's window. */
  coverage: string[];
  /** Window dates with no dinner planned. */
  unplannedDinners: string[];
  /** Planned meals in the window not yet added to the shopping list (a combined meal counts once). */
  mealsNotOnList: number;
  /** Unticked items on active lists — not in the basket yet. */
  unticked: number;
  /** Unticked items added after the order was marked placed: they need an amend. */
  addedSinceOrder: string[];
}

async function checklistFor(
  householdId: string,
  delivery: ResolvedDelivery,
  coverage: string[]
): Promise<DeliveryChecklist> {
  const weeks = [...new Set(coverage.map(weekStartOf))];
  const inWindow = new Set(coverage);

  const [entries, items] = await Promise.all([
    db
      .select({
        id: mealPlanEntries.id,
        groupId: mealPlanEntries.groupId,
        weekStartDate: mealPlans.weekStartDate,
        dayOfWeek: mealPlanEntries.dayOfWeek,
        mealType: mealPlanEntries.mealType,
        addedToShoppingListAt: mealPlanEntries.addedToShoppingListAt,
      })
      .from(mealPlanEntries)
      .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
      .where(
        and(eq(mealPlans.householdId, householdId), inArray(mealPlans.weekStartDate, weeks))
      ),
    db
      .select({ name: shoppingListItems.ingredientName, createdAt: shoppingListItems.createdAt })
      .from(shoppingListItems)
      .innerJoin(shoppingLists, eq(shoppingListItems.listId, shoppingLists.id))
      .where(
        and(
          eq(shoppingLists.householdId, householdId),
          eq(shoppingLists.status, "active"),
          eq(shoppingListItems.isChecked, false)
        )
      )
      .orderBy(asc(shoppingListItems.createdAt)),
  ]);

  const windowEntries = entries.filter((e) =>
    inWindow.has(addDaysToDate(e.weekStartDate, e.dayOfWeek))
  );
  const dinnerDates = new Set(
    windowEntries
      .filter((e) => e.mealType === "dinner")
      .map((e) => addDaysToDate(e.weekStartDate, e.dayOfWeek))
  );
  const notOnList = new Set(
    windowEntries.filter((e) => !e.addedToShoppingListAt).map((e) => e.groupId ?? e.id)
  );
  const orderedAt = delivery.status === "ordered" ? delivery.orderedAt : null;

  return {
    coverage,
    unplannedDinners: coverage.filter((d) => !dinnerDates.has(d)),
    mealsNotOnList: notOnList.size,
    unticked: items.length,
    addedSinceOrder: orderedAt
      ? items.filter((i) => i.createdAt > orderedAt).map((i) => i.name)
      : [],
  };
}

export interface DeliveryReport {
  delivery: ResolvedDelivery;
  checklist: DeliveryChecklist;
  cutoffAt: number;
}

/** A date's delivery and everything still outstanding for it. Null when there's no delivery that day. */
export async function getDeliveryReport(
  householdId: string,
  date: string,
  config?: DeliveryConfig
): Promise<DeliveryReport | null> {
  const c = config ?? (await getDeliveryConfig(householdId));
  const list = await listDeliveries(householdId, date, addDaysToDate(date, MAX_COVERAGE_DAYS), c);
  const delivery = list.find((d) => d.date === date);
  if (!delivery) return null;
  const checklist = await checklistFor(householdId, delivery, coverageDates(list, delivery, c));
  return { delivery, checklist, cutoffAt: cutoffEpoch(delivery, c.timezone) };
}

/** The soonest delivery that's coming and whose order hasn't closed yet. */
export async function getNextOpenDelivery(
  householdId: string,
  config?: DeliveryConfig,
  now: Date = new Date()
): Promise<DeliveryReport | null> {
  const c = config ?? (await getDeliveryConfig(householdId));
  const today = localNow(c.timezone, now).date;
  const list = await listDeliveries(householdId, today, addDaysToDate(today, 21), c);
  const next = list.find(
    (d) => d.status !== "skipped" && cutoffEpoch(d, c.timezone) > now.getTime()
  );
  return next ? getDeliveryReport(householdId, next.date, c) : null;
}

// ─── Changes ─────────────────────────────────────────────────────────────────

/**
 * Set one date's delivery. `"default"` drops any override so the weekly
 * pattern (and holidays) decide again. Skipping a date that has no regular
 * delivery removes a one-off. Marking an already-ordered date ordered again
 * keeps the original order time, so a double tap can't hide later additions.
 */
export async function setDeliveryState(
  ctx: HouseholdContext,
  date: string,
  target: DeliveryStatus | "default"
): Promise<void> {
  if (!isValidDate(date)) throw new Error("Date must be YYYY-MM-DD");
  const config = await getDeliveryConfig(ctx.householdId);
  const base = baseStatus(config, date);
  const desired = target === "skipped" && base === null ? "default" : target;

  const where = and(
    eq(deliveries.householdId, ctx.householdId),
    eq(deliveries.deliveryDate, date)
  );

  if (desired === "default" || (desired === base && desired !== "ordered")) {
    await db.delete(deliveries).where(where);
    return;
  }

  if (desired === "ordered") {
    const [existing] = await db
      .select({ status: deliveries.status })
      .from(deliveries)
      .where(where)
      .limit(1);
    if (existing?.status === "ordered") return;
  }

  const values =
    desired === "ordered"
      ? { status: desired, orderedAt: sql`now()`, orderedById: ctx.memberId, source: "manual" }
      : {
          status: desired,
          orderedAt: null,
          orderedById: null,
          slot: null,
          total: null,
          orderReference: null,
          source: "manual",
        };
  await db
    .insert(deliveries)
    .values({ householdId: ctx.householdId, deliveryDate: date, ...values })
    .onConflictDoUpdate({
      target: [deliveries.householdId, deliveries.deliveryDate],
      set: values,
    });
}

// ─── Display ─────────────────────────────────────────────────────────────────

export { shortDate, weekdayName, weekdayShort };

/** When an order closes, relative to `today`: "23:00 tonight", "23:00 tomorrow", "23:00 Sun 18 Oct". */
export function describeCutoff(delivery: ResolvedDelivery, today: string): string {
  const { cutoffDate, cutoffTime } = delivery;
  if (cutoffDate === today) {
    return `${cutoffTime} ${cutoffTime >= "17:00" ? "tonight" : "today"}`;
  }
  if (cutoffDate === addDaysToDate(today, 1)) return `${cutoffTime} tomorrow`;
  return `${cutoffTime} ${shortDate(cutoffDate)}`;
}

/** "Wed, Thu and Fri". */
export function listDays(dates: string[]): string {
  const names = dates.map(weekdayShort);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
