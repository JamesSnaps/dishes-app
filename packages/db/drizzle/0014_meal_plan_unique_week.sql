ALTER TABLE "meal_plans"
  ADD CONSTRAINT "meal_plans_household_week_unique"
  UNIQUE ("household_id", "week_start_date");
