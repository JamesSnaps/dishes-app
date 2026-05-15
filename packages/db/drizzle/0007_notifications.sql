CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "type" varchar(50) NOT NULL DEFAULT 'info',
  "title" varchar(255) NOT NULL,
  "body" text,
  "recipe_id" uuid REFERENCES "recipes"("id") ON DELETE SET NULL,
  "read_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "notifications_household_id_idx" ON "notifications"("household_id");
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications"("household_id", "created_at" DESC);
