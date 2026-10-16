import {
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { households, householdMembers } from "./households";

export interface AwayPeriod {
  /** "YYYY-MM-DD", inclusive. */
  from: string;
  /** "YYYY-MM-DD", inclusive. */
  to: string;
  label?: string;
}

/**
 * When the household's grocery deliveries come and when orders close. One row
 * per household; absent means no deliveries are set up.
 *
 * The order deadline is `cutoffTime` local time, `cutoffDaysBefore` days before
 * the delivery date (Sainsbury's: 23:00 the day before). Times are wall-clock
 * "HH:MM" in the household timezone from dinner reminder settings.
 */
export const deliverySettings = pgTable("delivery_settings", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  /** Regular delivery weekdays, 0 (Mon) … 6 (Sun). */
  weekdays: jsonb("weekdays").$type<number[]>().notNull().default([]),
  cutoffTime: varchar("cutoff_time", { length: 5 }).notNull().default("23:00"),
  cutoffDaysBefore: integer("cutoff_days_before").notNull().default(1),
  /** Reminder times on the deadline day, "HH:MM", each before the cutoff. */
  reminderTimes: jsonb("reminder_times")
    .$type<string[]>()
    .notNull()
    .default(["09:00", "19:00", "22:00"]),
  /**
   * Warn when a placed order's total is under this (e.g. the retailer's
   * minimum spend). Null means no check.
   */
  minOrderTotal: decimal("min_order_total", { precision: 10, scale: 2 }),
  /** Holidays: regular deliveries inside these ranges are skipped. */
  awayPeriods: jsonb("away_periods").$type<AwayPeriod[]>().notNull().default([]),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const DELIVERY_STATUSES = ["scheduled", "ordered", "skipped"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * A delivery date that differs from the plain weekly pattern: a one-off extra
 * delivery, a skipped one, or one whose order has been placed. Regular days
 * with nothing recorded have no row.
 *
 * Order details (slot, total, reference) are filled in by hand or, later, from
 * the retailer's confirmation emails via the integrations API.
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    // One of DELIVERY_STATUSES, enforced by a CHECK constraint.
    status: varchar("status", { length: 20 }).notNull().default("scheduled"),
    /** "08:00-09:00" style slot, when known. */
    slot: varchar("slot", { length: 50 }),
    total: decimal("total", { precision: 10, scale: 2 }),
    orderReference: varchar("order_reference", { length: 100 }),
    orderedAt: timestamp("ordered_at"),
    orderedById: uuid("ordered_by_id").references(() => householdMembers.id, {
      onDelete: "set null",
    }),
    /** "manual" or "email". */
    source: varchar("source", { length: 20 }).notNull().default("manual"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("deliveries_household_date_unique").on(t.householdId, t.deliveryDate),
    index("deliveries_household_date_idx").on(t.householdId, t.deliveryDate),
  ]
);

export type DeliverySettings = typeof deliverySettings.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
