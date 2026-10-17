-- Per-member notification choices, and the iOS app's devices for Apple Push.
--
-- notification_prefs holds every type except dinner and delivery-deadline
-- reminders, which keep their own opt-in columns; a missing key means that
-- type's default (see apps/web/lib/notification-types.ts).

ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "notification_prefs" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "apns_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "authelia_user" varchar(255) NOT NULL,
  "token" text NOT NULL,
  "environment" varchar(20) NOT NULL DEFAULT 'production',
  "device_name" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "apns_devices_token_unique" UNIQUE("token")
);

CREATE INDEX IF NOT EXISTS "apns_devices_household_id_idx" ON "apns_devices" ("household_id");
