CREATE TABLE IF NOT EXISTS "cook_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"cooked_at" timestamp DEFAULT now() NOT NULL,
	"rating" numeric(3, 1),
	"actual_duration" integer,
	"notes" text,
	"photo_url" text,
	"occasion" text,
	"cooked_for" text[],
	CONSTRAINT "cook_history_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE CASCADE,
	CONSTRAINT "cook_history_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE CASCADE
);
