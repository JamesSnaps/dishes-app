-- Recipes imported from another household's share link keep a pointer back to
-- the original, so the copy can be attributed ("Imported from Jane's Kitchen").
-- The FK is SET NULL: deleting the original must not delete the import.
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS imported_from_recipe_id uuid
    REFERENCES recipes(id) ON DELETE SET NULL;

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS imported_from_name varchar(255);
