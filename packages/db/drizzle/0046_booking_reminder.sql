-- How many days before a delivery to remind people to book it when no order
-- has been logged yet (0 for none).

ALTER TABLE "delivery_settings" ADD COLUMN IF NOT EXISTS "booking_reminder_days" integer NOT NULL DEFAULT 3;
