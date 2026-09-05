import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households, householdMembers } from "./households";
import { collections } from "./collections";
import { recipes } from "./recipes";

/**
 * Household-to-household library sharing.
 *
 * Distinct from `shareTokens` in ./sharing.ts, which is a public, anonymous
 * link to one recipe. A library share is a named, revocable relationship
 * between two households on the same instance: the grantee browses a filtered
 * view of the owner's library in-app and copies from it.
 */

export const libraryShareScopeEnum = pgEnum("library_share_scope", [
  "all",
  "collections",
  "tags",
]);

export const libraryShares = pgTable(
  "library_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerHouseholdId: uuid("owner_household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    // Null until the invite is redeemed — one row is both invite and grant.
    granteeHouseholdId: uuid("grantee_household_id").references(
      () => households.id,
      { onDelete: "cascade" }
    ),
    createdById: uuid("created_by_id").references(() => householdMembers.id, {
      onDelete: "set null",
    }),
    redeemedByMemberId: uuid("redeemed_by_member_id").references(
      () => householdMembers.id,
      { onDelete: "set null" }
    ),
    label: varchar("label", { length: 120 }),
    inviteCode: varchar("invite_code", { length: 64 }).notNull().unique(),
    // Applies only while unredeemed. A live grant never expires on its own —
    // a share that silently stops working is worse than one you must revoke.
    inviteExpiresAt: timestamp("invite_expires_at"),
    redeemedAt: timestamp("redeemed_at"),
    baseScope: libraryShareScopeEnum("base_scope").notNull().default("all"),
    excludeTags: text("exclude_tags").array().$type<string[]>().notNull().default([]),
    revokedByOwnerAt: timestamp("revoked_by_owner_at"),
    revokedByGranteeAt: timestamp("revoked_by_grantee_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("library_shares_owner_idx").on(t.ownerHouseholdId),
    index("library_shares_grantee_idx").on(t.granteeHouseholdId),
  ]
);

export const libraryShareCollections = pgTable(
  "library_share_collections",
  {
    shareId: uuid("share_id")
      .notNull()
      .references(() => libraryShares.id, { onDelete: "cascade" }),
    // Cascading from collections is the point: delete a collection and it
    // drops out of every scope that named it, with no code involved.
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.shareId, t.collectionId] })]
);

export const libraryShareTags = pgTable(
  "library_share_tags",
  {
    shareId: uuid("share_id")
      .notNull()
      .references(() => libraryShares.id, { onDelete: "cascade" }),
    tag: varchar("tag", { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.shareId, t.tag] })]
);

/** What has been copied out of a shared library, so the owner can see it. */
export const libraryShareImports = pgTable(
  "library_share_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareId: uuid("share_id").references(() => libraryShares.id, {
      onDelete: "set null",
    }),
    sourceRecipeId: uuid("source_recipe_id").references(() => recipes.id, {
      onDelete: "set null",
    }),
    copyRecipeId: uuid("copy_recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    granteeHouseholdId: uuid("grantee_household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    importedAt: timestamp("imported_at").defaultNow().notNull(),
  },
  (t) => [index("library_share_imports_share_idx").on(t.shareId)]
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const librarySharesRelations = relations(
  libraryShares,
  ({ one, many }) => ({
    ownerHousehold: one(households, {
      fields: [libraryShares.ownerHouseholdId],
      references: [households.id],
      relationName: "libraryShareOwner",
    }),
    granteeHousehold: one(households, {
      fields: [libraryShares.granteeHouseholdId],
      references: [households.id],
      relationName: "libraryShareGrantee",
    }),
    shareCollections: many(libraryShareCollections),
    shareTags: many(libraryShareTags),
    imports: many(libraryShareImports),
  })
);

export const libraryShareCollectionsRelations = relations(
  libraryShareCollections,
  ({ one }) => ({
    share: one(libraryShares, {
      fields: [libraryShareCollections.shareId],
      references: [libraryShares.id],
    }),
    collection: one(collections, {
      fields: [libraryShareCollections.collectionId],
      references: [collections.id],
    }),
  })
);

export const libraryShareTagsRelations = relations(
  libraryShareTags,
  ({ one }) => ({
    share: one(libraryShares, {
      fields: [libraryShareTags.shareId],
      references: [libraryShares.id],
    }),
  })
);

export const libraryShareImportsRelations = relations(
  libraryShareImports,
  ({ one }) => ({
    share: one(libraryShares, {
      fields: [libraryShareImports.shareId],
      references: [libraryShares.id],
    }),
  })
);
