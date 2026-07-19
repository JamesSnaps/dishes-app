CREATE TABLE IF NOT EXISTS "shopping_list_item_recipes" (
  "item_id" uuid NOT NULL REFERENCES "shopping_list_items"("id") ON DELETE CASCADE,
  "recipe_id" uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
  PRIMARY KEY ("item_id", "recipe_id")
);

-- Backfill from the existing single-recipe column
INSERT INTO "shopping_list_item_recipes" ("item_id", "recipe_id")
  SELECT "id", "recipe_id" FROM "shopping_list_items" WHERE "recipe_id" IS NOT NULL
  ON CONFLICT DO NOTHING;
