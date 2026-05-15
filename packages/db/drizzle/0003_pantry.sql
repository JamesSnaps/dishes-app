CREATE TABLE IF NOT EXISTS "pantry_staples" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "ingredient_name" varchar(255) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "pantry_stock" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "ingredient_name" varchar(255) NOT NULL,
  "amount" numeric(10, 3),
  "unit" varchar(50),
  "expires_at" timestamp,
  "added_at" timestamp DEFAULT now() NOT NULL
);
