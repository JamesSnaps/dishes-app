import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { households } from "./households";
import { recipes } from "./recipes";

// Saved "Ask about this recipe" conversations. Distinct from cook_assist_threads,
// which are anchored to a step during a cook — these are recipe-level questions
// (sides, timings, make-ahead) kept so the same thing isn't asked twice.
export const recipeAssistThreads = pgTable("recipe_assist_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  // First question in the thread, denormalised for the history list.
  title: text("title").notNull(),
  messages: jsonb("messages")
    .notNull()
    .$type<Array<{ role: "user" | "assistant"; content: string }>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
