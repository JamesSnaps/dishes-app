import { pgTable, uuid, text, varchar, timestamp, index, unique } from "drizzle-orm/pg-core";
import { households } from "./households";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    autheliaUser: varchar("authelia_user", { length: 255 }).notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("push_subscriptions_endpoint_unique").on(t.endpoint),
    index("push_subscriptions_household_id_idx").on(t.householdId),
  ]
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
