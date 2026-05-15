import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { households } from "./households";
import { recipes } from "./recipes";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 50 }).notNull().default("info"),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("notifications_household_id_idx").on(t.householdId),
    index("notifications_created_at_idx").on(t.householdId, t.createdAt),
  ]
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
