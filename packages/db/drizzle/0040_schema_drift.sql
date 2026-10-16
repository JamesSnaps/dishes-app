-- Bring a database built from these files in line with the Drizzle schema.
-- Each of these is in packages/db/src/schema but was never written as a
-- migration, so older servers have them (added by hand or `drizzle-kit push`)
-- while a fresh install does not. Every statement is guarded and safe to re-run.

-- Collection icons (collections.ts). /recipes and the dev seed fail without it.
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "icon" varchar(10);
--> statement-breakpoint
-- Dessert meal slots (meal-plans.ts, MealType in @dishes/shared).
ALTER TYPE "meal_type" ADD VALUE IF NOT EXISTS 'dessert' BEFORE 'snack';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipes_household_id_idx" ON "recipes" USING btree ("household_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopping_list_items_list_id_idx" ON "shopping_list_items" USING btree ("list_id");
