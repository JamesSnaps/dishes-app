-- A cook of a whole planned meal, rated as a meal (and its combination of
-- dishes), with each dish's own cook_history entry pointing back to it.

CREATE TABLE IF NOT EXISTS "meal_cooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "group_id" uuid REFERENCES "meal_plan_groups"("id") ON DELETE SET NULL,
  "meal_id" uuid REFERENCES "meals"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "recipe_ids" uuid[] NOT NULL,
  "cooked_at" timestamp DEFAULT now() NOT NULL,
  "rating" numeric(3, 1),
  "member_ratings" jsonb,
  "cooked_for" text[],
  "occasion" text,
  "notes" text,
  "actual_duration" integer
);

CREATE INDEX IF NOT EXISTS "meal_cooks_household_idx" ON "meal_cooks" ("household_id");
CREATE INDEX IF NOT EXISTS "meal_cooks_meal_idx" ON "meal_cooks" ("meal_id");

ALTER TABLE "cook_history" ADD COLUMN IF NOT EXISTS "meal_cook_id" uuid REFERENCES "meal_cooks"("id") ON DELETE SET NULL;
