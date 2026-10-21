-- The order of a day's meals as the household arranges them (the iOS app's
-- drag to reorder). 0 everywhere until someone reorders: the planner sorts by
-- position, then meal type, so nothing moves on its own.

ALTER TABLE "meal_plan_entries" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
ALTER TABLE "meal_plan_groups" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
