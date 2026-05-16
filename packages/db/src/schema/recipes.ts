import {
  boolean,
  decimal,
  index,
  integer,
  json,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households, householdMembers } from "./households";

export const difficultyEnum = pgEnum("difficulty", ["easy", "medium", "hard"]);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").references(() => householdMembers.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    cuisine: varchar("cuisine", { length: 100 }),
    prepTimeMinutes: integer("prep_time_minutes"),
    cookTimeMinutes: integer("cook_time_minutes"),
    servings: decimal("servings", { precision: 5, scale: 2 }),
    servingsUnit: varchar("servings_unit", { length: 50 }).default("servings"),
    difficulty: difficultyEnum("difficulty"),
    imageUrl: text("image_url"),
    thumbnailUrl: text("thumbnail_url"),
    sourceUrl: text("source_url"),
    isAiGenerated: boolean("is_ai_generated").notNull().default(false),
    isFavourite: boolean("is_favourite").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("recipes_household_id_idx").on(t.householdId)]
);

export const recipeIngredients = pgTable("recipe_ingredients", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  ingredientName: varchar("ingredient_name", { length: 255 }).notNull(),
  amount: text("amount"),
  unit: varchar("unit", { length: 50 }),
  preparation: varchar("preparation", { length: 255 }),
  isOptional: boolean("is_optional").notNull().default(false),
  groupLabel: varchar("group_label", { length: 100 }),
});

export const recipeSteps = pgTable("recipe_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  instruction: text("instruction").notNull(),
  durationMinutes: integer("duration_minutes"),
  timerLabel: varchar("timer_label", { length: 100 }),
  ingredientIds: json("ingredient_ids").$type<string[]>().default([]),
});

export const recipeTags = pgTable("recipe_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  tag: varchar("tag", { length: 100 }).notNull(),
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  household: one(households, {
    fields: [recipes.householdId],
    references: [households.id],
  }),
  createdBy: one(householdMembers, {
    fields: [recipes.createdById],
    references: [householdMembers.id],
  }),
  ingredients: many(recipeIngredients),
  steps: many(recipeSteps),
  tags: many(recipeTags),
}));

export const recipeIngredientsRelations = relations(
  recipeIngredients,
  ({ one }) => ({
    recipe: one(recipes, {
      fields: [recipeIngredients.recipeId],
      references: [recipes.id],
    }),
  })
);

export const recipeStepsRelations = relations(recipeSteps, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeSteps.recipeId],
    references: [recipes.id],
  }),
}));

export const recipeTagsRelations = relations(recipeTags, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeTags.recipeId],
    references: [recipes.id],
  }),
}));
