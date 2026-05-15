CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" varchar(100) PRIMARY KEY,
  "value" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
