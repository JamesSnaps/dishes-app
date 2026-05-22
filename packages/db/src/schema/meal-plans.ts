import {
  date,
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
  })
);
