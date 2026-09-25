-- Per-person ratings for a logged cook: [{"name": "Louis", "rating": 6}, ...].
-- Names match cooked_for (display names); ratings are 0–10 like cook_history.rating,
-- which stays as the cook's own overall rating.
ALTER TABLE "cook_history" ADD COLUMN IF NOT EXISTS "member_ratings" jsonb;
