import { pgTable, uuid, text, varchar, timestamp, index, unique } from "drizzle-orm/pg-core";
import { households } from "./households";

/**
 * The native iOS app's devices, for Apple Push (APNs). The web's browsers are
 * in push_subscriptions; a member's notifications go to both.
 */
export const apnsDevices = pgTable(
  "apns_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    autheliaUser: varchar("authelia_user", { length: 255 }).notNull(),
    /** Hex device token from didRegisterForRemoteNotifications. */
    token: text("token").notNull(),
    /** "sandbox" for Xcode (debug) builds, "production" for TestFlight/App Store. */
    environment: varchar("environment", { length: 20 }).notNull().default("production"),
    deviceName: varchar("device_name", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("apns_devices_token_unique").on(t.token),
    index("apns_devices_household_id_idx").on(t.householdId),
  ]
);

export type ApnsDevice = typeof apnsDevices.$inferSelect;
