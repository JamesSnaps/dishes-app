-- Optional minimum order value: placed orders under it are flagged in the app
-- and in the deadline-day reminders.
ALTER TABLE "delivery_settings" ADD COLUMN IF NOT EXISTS "min_order_total" numeric(10, 2);
