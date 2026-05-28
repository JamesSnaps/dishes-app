import { integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { households } from "./households";
import { recipes } from "./recipes";

export const cookAssistThreads = pgTable("cook_assist_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  messages: jsonb("messages")
    .notNull()
    .$type<Array<{ role: "user" | "assistant"; content: string }>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
