import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Crashes reported by the browser, kept so they can be read back in the app.
 *
 * Deliberately not household-scoped: the reporter runs at the moment the app is
 * already broken, and the thing that broke may well be the session or the sync
 * layer that would resolve a household. `household_id` is recorded when it
 * happens to be resolvable and is metadata, not a tenancy boundary — reads are
 * gated on the admin role instead. Trimmed to a fixed cap on write, so this
 * never grows unbounded.
 */
export const clientErrors = pgTable(
  "client_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    message: text("message").notNull(),
    stack: text("stack"),
    digest: varchar("digest", { length: 100 }),
    url: varchar("url", { length: 300 }),
    source: varchar("source", { length: 50 }),
    userAgent: varchar("user_agent", { length: 250 }),
    appVersion: varchar("app_version", { length: 20 }),
    autheliaUser: varchar("authelia_user", { length: 100 }),
    householdId: uuid("household_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    createdAtIdx: index("client_errors_created_at_idx").on(t.createdAt),
  })
);
