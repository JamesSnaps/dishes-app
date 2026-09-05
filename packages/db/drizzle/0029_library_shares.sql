-- A household can expose a filtered view of its library to one other household
-- on this instance: they browse it read-only and copy recipes into their own.
--
-- The scope lives here and is the single source of truth for both browsing and
-- importing. A base selector (whole library / named collections / named tags)
-- picks what is in; exclude_tags then takes things back out, and always wins.
--
-- One row is both the invite and the grant: grantee_household_id is null until
-- somebody redeems the code, which is what turns an invitation into a
-- relationship.

DO $$ BEGIN
  CREATE TYPE "library_share_scope" AS ENUM ('all', 'collections', 'tags');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "library_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_household_id" uuid NOT NULL,
  "grantee_household_id" uuid,
  "created_by_id" uuid,
  "redeemed_by_member_id" uuid,
  "label" varchar(120),
  "invite_code" varchar(64) NOT NULL,
  "invite_expires_at" timestamp,
  "redeemed_at" timestamp,
  "base_scope" "library_share_scope" DEFAULT 'all' NOT NULL,
  "exclude_tags" text[] DEFAULT '{}'::text[] NOT NULL,
  -- Either side can end the relationship independently, and the UI can say
  -- which of them did. Neither deletes the row: the ledger outlives the grant.
  "revoked_by_owner_at" timestamp,
  "revoked_by_grantee_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "library_shares_invite_code_uniq" UNIQUE ("invite_code"),
  CONSTRAINT "library_shares_no_self_share"
    CHECK ("grantee_household_id" IS NULL
           OR "grantee_household_id" <> "owner_household_id"),
  CONSTRAINT "library_shares_owner_household_id_fk"
    FOREIGN KEY ("owner_household_id") REFERENCES "households"("id") ON DELETE cascade,
  CONSTRAINT "library_shares_grantee_household_id_fk"
    FOREIGN KEY ("grantee_household_id") REFERENCES "households"("id") ON DELETE cascade,
  CONSTRAINT "library_shares_created_by_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "household_members"("id") ON DELETE set null,
  CONSTRAINT "library_shares_redeemed_by_member_id_fk"
    FOREIGN KEY ("redeemed_by_member_id") REFERENCES "household_members"("id") ON DELETE set null
);

CREATE INDEX IF NOT EXISTS "library_shares_owner_idx"
  ON "library_shares" ("owner_household_id");
CREATE INDEX IF NOT EXISTS "library_shares_grantee_idx"
  ON "library_shares" ("grantee_household_id");

-- At most one live grant between any pair. A revoked pair can be re-granted.
CREATE UNIQUE INDEX IF NOT EXISTS "library_shares_live_pair_uniq"
  ON "library_shares" ("owner_household_id", "grantee_household_id")
  WHERE "grantee_household_id" IS NOT NULL
    AND "revoked_by_owner_at" IS NULL
    AND "revoked_by_grantee_at" IS NULL;

-- Include selectors are child tables rather than array columns so that the FK
-- cascade narrows the scope on its own when a collection is deleted. An array
-- would keep a dangling id forever.
CREATE TABLE IF NOT EXISTS "library_share_collections" (
  "share_id" uuid NOT NULL,
  "collection_id" uuid NOT NULL,
  CONSTRAINT "library_share_collections_pk" PRIMARY KEY ("share_id", "collection_id"),
  CONSTRAINT "library_share_collections_share_id_fk"
    FOREIGN KEY ("share_id") REFERENCES "library_shares"("id") ON DELETE cascade,
  CONSTRAINT "library_share_collections_collection_id_fk"
    FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS "library_share_tags" (
  "share_id" uuid NOT NULL,
  "tag" varchar(64) NOT NULL,
  CONSTRAINT "library_share_tags_pk" PRIMARY KEY ("share_id", "tag"),
  CONSTRAINT "library_share_tags_share_id_fk"
    FOREIGN KEY ("share_id") REFERENCES "library_shares"("id") ON DELETE cascade
);

-- What has actually been copied. recipes.imported_from_recipe_id already gives
-- the copy its provenance, but it cannot tell the owner "six of mine were
-- taken", and it is set to null when the source is deleted.
CREATE TABLE IF NOT EXISTS "library_share_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "share_id" uuid,
  "source_recipe_id" uuid,
  "copy_recipe_id" uuid NOT NULL,
  "grantee_household_id" uuid NOT NULL,
  "imported_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "library_share_imports_share_id_fk"
    FOREIGN KEY ("share_id") REFERENCES "library_shares"("id") ON DELETE set null,
  CONSTRAINT "library_share_imports_source_recipe_id_fk"
    FOREIGN KEY ("source_recipe_id") REFERENCES "recipes"("id") ON DELETE set null,
  CONSTRAINT "library_share_imports_copy_recipe_id_fk"
    FOREIGN KEY ("copy_recipe_id") REFERENCES "recipes"("id") ON DELETE cascade,
  CONSTRAINT "library_share_imports_grantee_household_id_fk"
    FOREIGN KEY ("grantee_household_id") REFERENCES "households"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "library_share_imports_share_idx"
  ON "library_share_imports" ("share_id");

-- Import de-duplication looks up (household, source recipe) on every copy.
-- Batch imports do it once per selection, so it needs an index.
CREATE INDEX IF NOT EXISTS "recipes_imported_from_idx"
  ON "recipes" ("household_id", "imported_from_recipe_id")
  WHERE "imported_from_recipe_id" IS NOT NULL;
