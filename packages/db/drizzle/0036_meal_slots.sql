-- Saved meals get slots with options: one place in the meal ("the meat")
-- holding several recipes to choose from (chicken | pork | beef), optionally
-- pick-several (veg). Replaces meal_components, whose rows each become a
-- single-option slot so existing saved meals carry over unchanged.
CREATE TABLE IF NOT EXISTS "meal_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "meal_id" uuid NOT NULL REFERENCES "meals"("id") ON DELETE CASCADE,
  "role" varchar(20) NOT NULL DEFAULT 'side',
  "label" varchar(100),
  "position" integer NOT NULL DEFAULT 0,
  "allow_multiple" boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "meal_slots_meal_id_idx" ON "meal_slots" ("meal_id");

CREATE TABLE IF NOT EXISTS "meal_slot_options" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slot_id" uuid NOT NULL REFERENCES "meal_slots"("id") ON DELETE CASCADE,
  "recipe_id" uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
  "position" integer NOT NULL DEFAULT 0,
  "is_default" boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "meal_slot_options_slot_id_idx" ON "meal_slot_options" ("slot_id");

-- Carry existing saved meals across, once. Guarded so a re-run is a no-op.
DO $$
BEGIN
  IF to_regclass('public.meal_components') IS NOT NULL THEN
    INSERT INTO "meal_slots" ("id", "meal_id", "role", "position")
      SELECT "id", "meal_id", "role", "position" FROM "meal_components"
      ON CONFLICT ("id") DO NOTHING;
    INSERT INTO "meal_slot_options" ("slot_id", "recipe_id", "position", "is_default")
      SELECT "id", "recipe_id", 0, true FROM "meal_components";
    DROP TABLE "meal_components";
  END IF;
END $$;
