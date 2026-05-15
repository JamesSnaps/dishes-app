import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households, householdMembers } from "./households";
import { recipes } from "./recipes";

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => householdMembers.id, {
    onDelete: "set null",
  }),
  recipeId: uuid("recipe_id").references(() => recipes.id, {
    onDelete: "cascade",
  }),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const notesRelations = relations(notes, ({ one }) => ({
  household: one(households, {
    fields: [notes.householdId],
    references: [households.id],
  }),
  author: one(householdMembers, {
    fields: [notes.authorId],
    references: [householdMembers.id],
  }),
  recipe: one(recipes, {
    fields: [notes.recipeId],
    references: [recipes.id],
  }),
}));
