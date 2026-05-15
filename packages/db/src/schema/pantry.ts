import { decimal, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households } from "./households";

export const pantryStaples = pgTable("pantry_staples", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  ingredientName: varchar("ingredient_name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pantryStock = pgTable("pantry_stock", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  ingredientName: varchar("ingredient_name", { length: 255 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 3 }),
  unit: varchar("unit", { length: 50 }),
  expiresAt: timestamp("expires_at"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const pantryStaplesRelations = relations(pantryStaples, ({ one }) => ({
  household: one(households, {
    fields: [pantryStaples.householdId],
    references: [households.id],
  }),
}));

export const pantryStockRelations = relations(pantryStock, ({ one }) => ({
  household: one(households, {
    fields: [pantryStock.householdId],
    references: [households.id],
  }),
}));
