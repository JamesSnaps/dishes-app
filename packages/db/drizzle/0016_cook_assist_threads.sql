CREATE TABLE IF NOT EXISTS "cook_assist_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL,
  "recipe_id" uuid NOT NULL,
  "step_number" integer NOT NULL,
  "messages" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "cook_assist_threads_household_id_households_id_fk"
    FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE cascade,
  CONSTRAINT "cook_assist_threads_recipe_id_recipes_id_fk"
    FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE cascade
);
