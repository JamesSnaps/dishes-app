-- Distinguish a logged cook from a bare rating. Rating a recipe from the star
-- row inserts a cook_history entry too, which previously inflated "Cooked N
-- times". 'cook' rows count towards the cook count and average duration;
-- 'rating' rows only contribute their rating to the average.
--
-- Existing rows all default to 'cook': the two kinds are indistinguishable
-- after the fact, so no backfill is attempted — history stays exactly as it
-- reads today and only new ratings are marked.
ALTER TABLE cook_history
  ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'cook';
