CREATE TABLE IF NOT EXISTS "taste_profile" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "cuisines" jsonb NOT NULL DEFAULT '{}',
  "ingredients" jsonb NOT NULL DEFAULT '{}',
  "tags" jsonb NOT NULL DEFAULT '{}',
  "meal_types" jsonb NOT NULL DEFAULT '{}',
  "rated_cook_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "taste_profile_household_id_unique" UNIQUE("household_id")
);
