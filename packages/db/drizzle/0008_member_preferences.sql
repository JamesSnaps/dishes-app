ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "dietary_flags" text[];
ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "dislikes" text[];
ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "preferences" text[];
ALTER TABLE "household_members" ADD COLUMN IF NOT EXISTS "custom_notes" text;
