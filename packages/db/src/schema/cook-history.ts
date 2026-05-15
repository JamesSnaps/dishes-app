import {
  decimal,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households } from "./households";
import { recipes } from "./recipes";

export const cookHistory = pgTable("cook_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  cookedAt: timestamp("cooked_at").defaultNow().notNull(),
  rating: decimal("rating", { precision: 3, scale: 1 }),
  actualDuration: integer("actual_duration"),
  notes: text("notes"),
  photoUrl: text("photo_url"),
  occasion: text("occasion"),
  cookedFor: text("cooked_for").array(),
});

export const cookHistoryRelations = relations(cookHistory, ({ one }) => ({
  household: one(households, {
    fields: [cookHistory.householdId],
    references: [households.id],
  }),
  recipe: one(recipes, {
    fields: [cookHistory.recipeId],
    references: [recipes.id],
  }),
}));
