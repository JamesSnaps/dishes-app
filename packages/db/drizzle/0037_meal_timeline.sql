-- Cooking schedules for planned meals: a serve-by time and an optional
-- AI-planned timeline (cues as minutes before serving).
ALTER TABLE "meal_plan_groups" ADD COLUMN IF NOT EXISTS "serve_at" varchar(5);
ALTER TABLE "meal_plan_groups" ADD COLUMN IF NOT EXISTS "timeline" jsonb;
