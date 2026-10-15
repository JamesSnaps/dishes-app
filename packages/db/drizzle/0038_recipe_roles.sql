ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "meal_role" varchar(20);
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_meal_role_check" CHECK ("meal_role" IN ('main', 'side', 'sauce', 'other'));
