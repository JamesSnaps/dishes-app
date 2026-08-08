-- Saved "Ask about this recipe" conversations. Separate from
-- cook_assist_threads (which are anchored to a step during a cook) — these are
-- recipe-level questions kept so past answers can be reread instead of re-asked.
CREATE TABLE IF NOT EXISTS "recipe_assist_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "recipe_id" uuid NOT NULL,
  "title" text NOT NULL,
  "messages" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "recipe_assist_threads_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE cascade,
  CONSTRAINT "recipe_assist_threads_recipe_id_recipes_id_fk"
    FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "recipe_assist_threads_recipe_idx"
  ON "recipe_assist_threads" ("recipe_id", "updated_at" DESC);
