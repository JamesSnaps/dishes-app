import {
  boolean,
  decimal,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households, householdMembers } from "./households";
import { recipes } from "./recipes";

export const listStatusEnum = pgEnum("list_status", [
  "active",
  "completed",
  "archived",
]);

export const shoppingLists = pgTable("shopping_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  createdById: uuid("created_by_id").references(() => householdMembers.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 255 }).notNull(),
  status: listStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const shoppingListItems = pgTable("shopping_list_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  listId: uuid("list_id")
    .notNull()
    .references(() => shoppingLists.id, { onDelete: "cascade" }),
  recipeId: uuid("recipe_id").references(() => recipes.id, {
    onDelete: "set null",
  }),
  ingredientName: varchar("ingredient_name", { length: 255 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 3 }),
  unit: varchar("unit", { length: 50 }),
  notes: text("notes"),
  isChecked: boolean("is_checked").notNull().default(false),
  position: integer("position").notNull().default(0),
  category: varchar("category", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const shoppingListsRelations = relations(
  shoppingLists,
  ({ one, many }) => ({
    household: one(households, {
      fields: [shoppingLists.householdId],
      references: [households.id],
    }),
    createdBy: one(householdMembers, {
      fields: [shoppingLists.createdById],
      references: [householdMembers.id],
    }),
    items: many(shoppingListItems),
  })
);

export const shoppingListItemsRelations = relations(
  shoppingListItems,
  ({ one }) => ({
    list: one(shoppingLists, {
      fields: [shoppingListItems.listId],
      references: [shoppingLists.id],
    }),
    recipe: one(recipes, {
      fields: [shoppingListItems.recipeId],
      references: [recipes.id],
    }),
  })
);
