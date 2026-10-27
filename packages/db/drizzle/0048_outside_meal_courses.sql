-- A meal eaten out with several courses (starter, main, dessert…): each one's
-- words, printed kcal and photo, and its share of the estimate. The nutrition
-- columns stay the whole sitting's.

ALTER TABLE "outside_meals" ADD COLUMN IF NOT EXISTS "courses" jsonb;
