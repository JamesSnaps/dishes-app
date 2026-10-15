-- Grocery deliveries: weekly delivery days, order deadline reminders,
-- holidays, and per-date overrides / order status.
CREATE TABLE IF NOT EXISTS "delivery_settings" (
  "household_id" uuid PRIMARY KEY REFERENCES "households"("id") ON DELETE CASCADE,
  "weekdays" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "cutoff_time" varchar(5) NOT NULL DEFAULT '23:00',
  "cutoff_days_before" integer NOT NULL DEFAULT 1,
  "reminder_times" jsonb NOT NULL DEFAULT '["09:00","19:00","22:00"]'::jsonb,
  "away_periods" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "delivery_date" date NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'scheduled' CHECK ("status" IN ('scheduled', 'ordered', 'skipped')),
  "slot" varchar(50),
  "total" numeric(10, 2),
  "order_reference" varchar(100),
  "ordered_at" timestamp,
  "ordered_by_id" uuid REFERENCES "household_members"("id") ON DELETE SET NULL,
  "source" varchar(20) NOT NULL DEFAULT 'manual',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "deliveries_household_date_unique" UNIQUE ("household_id", "delivery_date")
);
CREATE INDEX IF NOT EXISTS "deliveries_household_date_idx" ON "deliveries" ("household_id", "delivery_date");
ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "delivery_reminders" boolean NOT NULL DEFAULT false;
