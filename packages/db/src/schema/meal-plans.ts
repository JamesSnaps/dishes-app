import {
  boolean,
  date,
  index,
  integer,
  decimal,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households, householdMembers } from "./households";
import { recipes } from "./recipes";

export const mealPlanStatusEnum = pgEnum("meal_plan_status", [
  "draft",
  "active",
  "archived",
]);

export const mealTypeEnum = pgEnum("meal_type", [
  "breakfast",
  "lunch",
  "dinner",
  "dessert",
  "snack",
]);

export const mealPlans = pgTable(
  "meal_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").references(() => householdMembers.id, {
      onDelete: "set null",
    }),
    weekStartDate: date("week_start_date").notNull(),
    status: mealPlanStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("meal_plans_household_week_unique").on(t.householdId, t.weekStartDate)]
);

// ─── Saved meals ─────────────────────────────────────────────────────────────
//
// A saved meal is a reusable combination of recipes — "Sunday Roast" as roast
// chicken + roast potatoes + cabbage + gravy. Adding one to the plan copies its
// components into a meal_plan_group, so swapping the meat for one week never
// edits the saved meal. Lives in this file because groups reference it and it
// references the meal_type enum; split across files that is an import cycle.

export const meals = pgTable(
  "meals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").references(() => householdMembers.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 200 }).notNull(),
    notes: text("notes"),
    defaultMealType: mealTypeEnum("default_meal_type").notNull().default("dinner"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("meals_household_id_idx").on(t.householdId)]
);

// A slot is one place in the meal — "the meat", "the veg". It holds one or
// more recipe options: a single-choice slot is filled by exactly one of them
// (chicken | pork | beef), a pick-several slot by any number (broccoli,
// carrots, peas). Which options start ticked is remembered from the last time
// the meal went on the plan.
export const mealSlots = pgTable(
  "meal_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mealId: uuid("meal_id")
      .notNull()
      .references(() => meals.id, { onDelete: "cascade" }),
    // One of MEAL_ROLES (@dishes/shared), validated in app code.
    role: varchar("role", { length: 20 }).notNull().default("side"),
    /** Optional name for the slot ("Veg", "Meat"); the role labels it otherwise. */
    label: varchar("label", { length: 100 }),
    position: integer("position").notNull().default(0),
    allowMultiple: boolean("allow_multiple").notNull().default(false),
  },
  (t) => [index("meal_slots_meal_id_idx").on(t.mealId)]
);

export const mealSlotOptions = pgTable(
  "meal_slot_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => mealSlots.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** Pre-selected when the meal is next added — last time's choice. */
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [index("meal_slot_options_slot_id_idx").on(t.slotId)]
);

// ─── Planned meal groups ─────────────────────────────────────────────────────
//
// One combined meal on the plan: the recipes in it are ordinary entries that
// point here. The group owns its slot (day + meal type); entries keep their own
// copies of both because the shopping list, dinner reminders, the integrations
// API and the native app all read them from entries. The meal-plan service is
// the only writer and keeps the two in step — moving a group moves its
// entries, and moving a single entry elsewhere detaches it.
//
// This is also where per-meal cooking state (serve time, the orchestrated
// timeline) will live, which is why it is a table and not a tag on entries.

export const mealPlanGroups = pgTable(
  "meal_plan_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mealPlanId: uuid("meal_plan_id")
      .notNull()
      .references(() => mealPlans.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    dayOfWeek: integer("day_of_week").notNull(), // 0=Mon … 6=Sun
    mealType: mealTypeEnum("meal_type").notNull().default("dinner"),
    sourceMealId: uuid("source_meal_id").references(() => meals.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("meal_plan_groups_plan_idx").on(t.mealPlanId)]
);

export const mealPlanEntries = pgTable("meal_plan_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  mealPlanId: uuid("meal_plan_id")
    .notNull()
    .references(() => mealPlans.id, { onDelete: "cascade" }),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Mon … 6=Sun
  mealType: mealTypeEnum("meal_type").notNull().default("dinner"),
  servings: decimal("servings", { precision: 5, scale: 2 }),
  notes: varchar("notes", { length: 500 }),
  addedToShoppingListAt: timestamp("added_to_shopping_list_at"),
  // Removing a group removes its recipes; detaching one just clears this.
  groupId: uuid("group_id").references(() => mealPlanGroups.id, {
    onDelete: "cascade",
  }),
  mealRole: varchar("meal_role", { length: 20 }), // MEAL_ROLES, only when grouped
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const mealPlansRelations = relations(mealPlans, ({ one, many }) => ({
  household: one(households, {
    fields: [mealPlans.householdId],
    references: [households.id],
  }),
  createdBy: one(householdMembers, {
    fields: [mealPlans.createdById],
    references: [householdMembers.id],
  }),
  entries: many(mealPlanEntries),
  groups: many(mealPlanGroups),
}));

export const mealsRelations = relations(meals, ({ one, many }) => ({
  household: one(households, {
    fields: [meals.householdId],
    references: [households.id],
  }),
  slots: many(mealSlots),
}));

export const mealSlotsRelations = relations(mealSlots, ({ one, many }) => ({
  meal: one(meals, {
    fields: [mealSlots.mealId],
    references: [meals.id],
  }),
  options: many(mealSlotOptions),
}));

export const mealSlotOptionsRelations = relations(mealSlotOptions, ({ one }) => ({
  slot: one(mealSlots, {
    fields: [mealSlotOptions.slotId],
    references: [mealSlots.id],
  }),
  recipe: one(recipes, {
    fields: [mealSlotOptions.recipeId],
    references: [recipes.id],
  }),
}));

export const mealPlanGroupsRelations = relations(mealPlanGroups, ({ one, many }) => ({
  mealPlan: one(mealPlans, {
    fields: [mealPlanGroups.mealPlanId],
    references: [mealPlans.id],
  }),
  sourceMeal: one(meals, {
    fields: [mealPlanGroups.sourceMealId],
    references: [meals.id],
  }),
  entries: many(mealPlanEntries),
}));

export const mealPlanEntriesRelations = relations(
  mealPlanEntries,
  ({ one }) => ({
    mealPlan: one(mealPlans, {
      fields: [mealPlanEntries.mealPlanId],
      references: [mealPlans.id],
    }),
    recipe: one(recipes, {
      fields: [mealPlanEntries.recipeId],
      references: [recipes.id],
    }),
    group: one(mealPlanGroups, {
      fields: [mealPlanEntries.groupId],
      references: [mealPlanGroups.id],
    }),
  })
);
