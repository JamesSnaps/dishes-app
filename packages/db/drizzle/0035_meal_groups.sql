-- Combined meals: saved meal templates (meals + meal_components) and planned
-- meal groups that tie several meal_plan_entries together (a roast dinner as
-- one meal of several recipes).
CREATE TABLE IF NOT EXISTS "meals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "created_by_id" uuid REFERENCES "household_members"("id") ON DELETE SET NULL,
  "title" varchar(200) NOT NULL,
  "notes" text,
  "default_meal_type" "meal_type" NOT NULL DEFAULT 'dinner',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "meals_household_id_idx" ON "meals" ("household_id");

CREATE TABLE IF NOT EXISTS "meal_components" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "meal_id" uuid NOT NULL REFERENCES "meals"("id") ON DELETE CASCADE,
  "recipe_id" uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
  "role" varchar(20) NOT NULL DEFAULT 'side',
  "position" integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "meal_components_meal_id_idx" ON "meal_components" ("meal_id");

CREATE TABLE IF NOT EXISTS "meal_plan_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "meal_plan_id" uuid NOT NULL REFERENCES "meal_plans"("id") ON DELETE CASCADE,
  "title" varchar(200) NOT NULL,
  "day_of_week" integer NOT NULL,
  "meal_type" "meal_type" NOT NULL DEFAULT 'dinner',
  "source_meal_id" uuid REFERENCES "meals"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "meal_plan_groups_plan_idx" ON "meal_plan_groups" ("meal_plan_id");

ALTER TABLE "meal_plan_entries" ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "meal_plan_groups"("id") ON DELETE CASCADE;
ALTER TABLE "meal_plan_entries" ADD COLUMN IF NOT EXISTS "meal_role" varchar(20);
CREATE INDEX IF NOT EXISTS "meal_plan_entries_group_idx" ON "meal_plan_entries" ("group_id");

-- Groups sync to offline clients like entries do (see 0025_sync_change_log.sql).
DROP TRIGGER IF EXISTS sync_meal_plan_groups ON meal_plan_groups;
CREATE TRIGGER sync_meal_plan_groups AFTER INSERT OR UPDATE OR DELETE ON meal_plan_groups
  FOR EACH ROW EXECUTE FUNCTION sync_log_parent('meal_plan_group', 'id', 'meal_plan_id', 'meal_plans');
