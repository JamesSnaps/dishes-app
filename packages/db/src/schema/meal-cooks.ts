import { decimal, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { households } from "./households";
import { mealPlanGroups, meals } from "./meal-plans";
import type { MemberRating } from "./cook-history";

/**
 * One cook of a whole planned meal — "Sunday roast, 18 Oct" — with what the
 * meal was like as a whole. Each dish still gets its own cook_history entry
 * (pointing back here through `meal_cook_id`), so recipe ratings and timings
 * keep learning; this row is what lets a saved meal be rated as a meal, and
 * its combinations compared (lamb + gratin vs lamb + mash).
 */
export const mealCooks = pgTable(
  "meal_cooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** The planned meal cooked; null once that plan is gone. */
    groupId: uuid("group_id").references(() => mealPlanGroups.id, { onDelete: "set null" }),
    /** The saved meal it was planned from, if any. */
    mealId: uuid("meal_id").references(() => meals.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** The dishes eaten, sorted — the combination this cook rates. */
    recipeIds: uuid("recipe_ids").array().notNull(),
    cookedAt: timestamp("cooked_at").defaultNow().notNull(),
    /** 0–10 (half stars), the cook's own view of the meal as a whole. */
    rating: decimal("rating", { precision: 3, scale: 1 }),
    memberRatings: jsonb("member_ratings").$type<MemberRating[]>(),
    cookedFor: text("cooked_for").array(),
    occasion: text("occasion"),
    notes: text("notes"),
    actualDuration: integer("actual_duration"),
  },
  (t) => [
    index("meal_cooks_household_idx").on(t.householdId),
    index("meal_cooks_meal_idx").on(t.mealId),
  ]
);
