import { integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households } from "./households";

export const tasteProfiles = pgTable("taste_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .unique()
    .references(() => households.id, { onDelete: "cascade" }),
  cuisines: jsonb("cuisines").$type<Record<string, number>>().notNull().default({}),
  ingredients: jsonb("ingredients").$type<Record<string, number>>().notNull().default({}),
  tags: jsonb("tags").$type<Record<string, number>>().notNull().default({}),
  mealTypes: jsonb("meal_types").$type<Record<string, number>>().notNull().default({}),
  ratedCookCount: integer("rated_cook_count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tasteProfilesRelations = relations(tasteProfiles, ({ one }) => ({
  household: one(households, {
    fields: [tasteProfiles.householdId],
    references: [households.id],
  }),
}));
