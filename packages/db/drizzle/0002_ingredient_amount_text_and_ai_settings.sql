ALTER TABLE "recipe_ingredients" ALTER COLUMN "amount" TYPE text USING amount::text;
ALTER TABLE "ai_configurations" ADD COLUMN "default_prompt" text;
ALTER TABLE "ai_configurations" ADD COLUMN "measurement_system" varchar(20) NOT NULL DEFAULT 'metric';
