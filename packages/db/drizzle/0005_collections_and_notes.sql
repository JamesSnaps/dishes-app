-- Collections
CREATE TABLE IF NOT EXISTS "collections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Recipe ↔ Collection join table
CREATE TABLE IF NOT EXISTS "recipe_collections" (
  "collection_id" uuid NOT NULL REFERENCES "collections"("id") ON DELETE CASCADE,
  "recipe_id" uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
  "added_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "recipe_collections_pkey" PRIMARY KEY ("collection_id", "recipe_id")
);

-- Notes
CREATE TABLE IF NOT EXISTS "notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "author_id" uuid REFERENCES "household_members"("id") ON DELETE SET NULL,
  "recipe_id" uuid REFERENCES "recipes"("id") ON DELETE CASCADE,
  "title" varchar(255) NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "collections_household_id_idx" ON "collections"("household_id");
CREATE INDEX IF NOT EXISTS "recipe_collections_recipe_id_idx" ON "recipe_collections"("recipe_id");
CREATE INDEX IF NOT EXISTS "notes_household_id_idx" ON "notes"("household_id");
CREATE INDEX IF NOT EXISTS "notes_recipe_id_idx" ON "notes"("recipe_id");
