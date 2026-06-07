-- Recipe nutrition (per serving). All nullable; populated by AI or manual entry.
DO $$ BEGIN
  CREATE TYPE "nutrition_source" AS ENUM ('none', 'ai', 'manual');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "calories" integer;
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "protein_g" numeric(6,1);
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "carbs_g" numeric(6,1);
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "fat_g" numeric(6,1);
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "fiber_g" numeric(6,1);
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "sugar_g" numeric(6,1);
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "sodium_mg" numeric(7,1);
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "nutrition_source" "nutrition_source" NOT NULL DEFAULT 'none';
