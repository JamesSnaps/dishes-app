-- Saturated fat per serving, alongside the existing nutrition columns. Total
-- fat alone can't tell olive oil from butter, which is what a cholesterol-
-- lowering diet cares about.
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "saturated_fat_g" numeric(6,1);
