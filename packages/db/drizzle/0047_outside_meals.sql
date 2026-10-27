-- Meals not cooked from the library: eaten out, takeaways, at friends',
-- skipped. A future date is a plan, a past one a log. Nutrition is one
-- portion, as eaten. Synced to offline clients like cook_history.

CREATE TABLE IF NOT EXISTS "outside_meals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "created_by_id" uuid REFERENCES "household_members"("id") ON DELETE SET NULL,
  "date" date NOT NULL,
  "meal_type" "meal_type" DEFAULT 'dinner' NOT NULL,
  "kind" varchar(20) DEFAULT 'eat_out' NOT NULL,
  "title" varchar(200),
  "place" varchar(200),
  "cuisine" varchar(100),
  "description" text,
  "menu_text" text,
  "portion" varchar(20) DEFAULT 'typical' NOT NULL,
  "components" jsonb,
  "main_ingredients" text[],
  "menu_kcal" integer,
  "calories" integer,
  "protein_g" numeric(6, 1),
  "carbs_g" numeric(6, 1),
  "fat_g" numeric(6, 1),
  "saturated_fat_g" numeric(6, 1),
  "fiber_g" numeric(6, 1),
  "sugar_g" numeric(6, 1),
  "sodium_mg" numeric(7, 1),
  "nutrition_source" "nutrition_source" DEFAULT 'none' NOT NULL,
  "eaten_by" text[],
  "rating" numeric(3, 1),
  "member_ratings" jsonb,
  "notes" text,
  "photo_url" text,
  "menu_photo_url" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "outside_meals_household_date_idx" ON "outside_meals" ("household_id", "date");

DROP TRIGGER IF EXISTS sync_outside_meals ON outside_meals;
CREATE TRIGGER sync_outside_meals AFTER INSERT OR UPDATE OR DELETE ON outside_meals
  FOR EACH ROW EXECUTE FUNCTION sync_log_self('outside_meal');
