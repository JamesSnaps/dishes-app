import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households } from "./households";
import { recipes } from "./recipes";

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  icon: varchar("icon", { length: 10 }),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const recipeCollections = pgTable(
  "recipe_collections",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.recipeId] })]
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  household: one(households, {
    fields: [collections.householdId],
    references: [households.id],
  }),
  recipeCollections: many(recipeCollections),
}));

export const recipeCollectionsRelations = relations(
  recipeCollections,
  ({ one }) => ({
    collection: one(collections, {
      fields: [recipeCollections.collectionId],
      references: [collections.id],
    }),
    recipe: one(recipes, {
      fields: [recipeCollections.recipeId],
      references: [recipes.id],
    }),
  })
);
