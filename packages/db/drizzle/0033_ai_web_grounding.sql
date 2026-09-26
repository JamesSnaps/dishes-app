-- Household toggle: ground full-recipe generation on web search results.
ALTER TABLE "ai_configurations" ADD COLUMN IF NOT EXISTS "web_grounding" boolean NOT NULL DEFAULT false;
