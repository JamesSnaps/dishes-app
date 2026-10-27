import {
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { households, householdMembers } from "./households";
import { mealTypeEnum } from "./meal-plans";
import { nutritionSourceEnum } from "./recipes";
import type { MemberRating } from "./cook-history";

/**
 * A meal not cooked from the library — eaten out, a takeaway, at friends', or
 * skipped. Without these the health picture has holes: a steak out never
 * counts towards the red-meat target and a takeaway's salt never reaches the
 * weekly averages.
 *
 * Deliberately its own table rather than a recipe-less plan entry or cook:
 * shopping, reminders, the integrations API and sync all assume an entry has
 * a recipe. A future date is a plan ("eating out Friday"), a past one a log.
 *
 * Nutrition is for one portion, as eaten, and always an estimate unless typed
 * in. `mainIngredients` is what the protein targets read (`proteinsOf`), so a
 * meal counts towards them before its numbers are estimated.
 */
export const outsideMeals = pgTable(
  "outside_meals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").references(() => householdMembers.id, {
      onDelete: "set null",
    }),
    date: date("date").notNull(),
    mealType: mealTypeEnum("meal_type").notNull().default("dinner"),
    // One of OUTSIDE_MEAL_KINDS (@dishes/shared), validated in app code.
    kind: varchar("kind", { length: 20 }).notNull().default("eat_out"),
    /** What was eaten, short: "Ribeye & chips". */
    title: varchar("title", { length: 200 }),
    place: varchar("place", { length: 200 }),
    cuisine: varchar("cuisine", { length: 100 }),
    /** In the eater's own words. */
    description: text("description"),
    /** The dish's line from the menu — typed, pasted or read from a photo. */
    menuText: text("menu_text"),
    // One of OUTSIDE_MEAL_PORTIONS: lighter / typical / indulgent.
    portion: varchar("portion", { length: 20 }).notNull().default("typical"),
    /** The parts of the plate, as read: ["8oz ribeye", "triple-cooked chips", …]. */
    components: jsonb("components").$type<string[]>(),
    mainIngredients: text("main_ingredients").array().$type<string[]>(),
    /** Calories printed on the menu: taken as given, the rest scaled to it. */
    menuKcal: integer("menu_kcal"),
    calories: integer("calories"),
    proteinG: decimal("protein_g", { precision: 6, scale: 1 }),
    carbsG: decimal("carbs_g", { precision: 6, scale: 1 }),
    fatG: decimal("fat_g", { precision: 6, scale: 1 }),
    saturatedFatG: decimal("saturated_fat_g", { precision: 6, scale: 1 }),
    fiberG: decimal("fiber_g", { precision: 6, scale: 1 }),
    sugarG: decimal("sugar_g", { precision: 6, scale: 1 }),
    sodiumMg: decimal("sodium_mg", { precision: 7, scale: 1 }),
    nutritionSource: nutritionSourceEnum("nutrition_source").notNull().default("none"),
    /** Display names of who ate it (like cook_history.cooked_for); null = everyone. */
    eatenBy: text("eaten_by").array(),
    /** 0–10, the household's view; `memberRatings` holds each voice. */
    rating: decimal("rating", { precision: 3, scale: 1 }),
    memberRatings: jsonb("member_ratings").$type<MemberRating[]>(),
    notes: text("notes"),
    photoUrl: text("photo_url"),
    menuPhotoUrl: text("menu_photo_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("outside_meals_household_date_idx").on(t.householdId, t.date)]
);

export type OutsideMeal = typeof outsideMeals.$inferSelect;
