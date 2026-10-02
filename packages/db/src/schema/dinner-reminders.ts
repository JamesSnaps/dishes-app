import {
  boolean,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { households } from "./households";
import { mealPlans } from "./meal-plans";

/**
 * Household-level dinner timing for "start cooking" reminders. One row per
 * household; absent means the defaults below apply.
 *
 * Times are local wall-clock "HH:MM" strings interpreted in `timezone`, so a
 * 17:00 dinner stays 17:00 across daylight-saving changes.
 */
export const dinnerReminderSettings = pgTable("dinner_reminder_settings", {
  householdId: uuid("household_id")
    .primaryKey()
    .references(() => households.id, { onDelete: "cascade" }),
  dinnerTime: varchar("dinner_time", { length: 5 }).notNull().default("17:00"),
  /** Optional per-weekday defaults, keyed "0" (Mon) … "6" (Sun) → "HH:MM". */
  dayTimes: jsonb("day_times").$type<Record<string, string>>().notNull().default({}),
  /** How long before the start-cooking time the reminder fires. */
  leadMinutes: integer("lead_minutes").notNull().default(10),
  timezone: varchar("timezone", { length: 64 }).notNull().default("Europe/London"),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/**
 * One-off settings for a single planned day — a dinner time that differs from
 * the defaults, or "no reminder tonight". Hangs off the week's meal plan so it
 * applies to that date only.
 */
export const mealPlanDays = pgTable(
  "meal_plan_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mealPlanId: uuid("meal_plan_id")
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(), // 0=Mon … 6=Sun
    /** Null = use the household/weekday default. */
    dinnerTime: varchar("dinner_time", { length: 5 }),
    reminderEnabled: boolean("reminder_enabled").notNull().default(true),
  },
  (t) => [unique("meal_plan_days_plan_day_unique").on(t.mealPlanId, t.dayOfWeek)]
);

export type DinnerReminderSettings = typeof dinnerReminderSettings.$inferSelect;
export type MealPlanDay = typeof mealPlanDays.$inferSelect;
