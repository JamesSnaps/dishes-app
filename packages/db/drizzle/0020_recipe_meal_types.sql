-- Recipe meal-type suitability. Drives meal-plan slot matching so the planner
-- stops placing dinner/lunch dishes into breakfast slots. text[] (not the
-- meal_type enum) to avoid coupling; values validated in app code.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS meal_types text[];
