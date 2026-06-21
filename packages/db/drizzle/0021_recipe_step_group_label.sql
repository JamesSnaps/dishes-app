-- Step sections. Lets a recipe's method be grouped into named sub-recipes
-- (e.g. "Granola", "Smoothie"), mirroring recipe_ingredients.group_label.
-- Nullable; blank/null means the step is ungrouped.
ALTER TABLE recipe_steps ADD COLUMN IF NOT EXISTS group_label varchar(100);
