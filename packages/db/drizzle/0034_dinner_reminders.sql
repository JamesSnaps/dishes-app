-- Dinner "start cooking" reminders: household timing defaults, per-member
-- opt-in, and one-off per-day overrides on the meal plan.
CREATE TABLE IF NOT EXISTS "dinner_reminder_settings" (
  "household_id" uuid PRIMARY KEY REFERENCES "households"("id") ON DELETE CASCADE,
  "dinner_time" varchar(5) NOT NULL DEFAULT '17:00',
  "day_times" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "lead_minutes" integer NOT NULL DEFAULT 10,
  "timezone" varchar(64) NOT NULL DEFAULT 'Europe/London',
  "updated_at" timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "dinner_reminders" boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "meal_plan_days" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "meal_plan_id" uuid NOT NULL REFERENCES "meal_plans"("id") ON DELETE CASCADE,
  "day_of_week" integer NOT NULL,
  "dinner_time" varchar(5),
  "reminder_enabled" boolean NOT NULL DEFAULT true,
  CONSTRAINT "meal_plan_days_plan_day_unique" UNIQUE ("meal_plan_id", "day_of_week")
);
