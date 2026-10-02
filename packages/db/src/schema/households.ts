import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const memberRoleEnum = pgEnum("member_role", ["admin", "adult", "child"]);

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const householdMembers = pgTable("household_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  autheliaUser: varchar("authelia_user", { length: 255 }).notNull(),
  role: memberRoleEnum("role").notNull().default("adult"),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  birthYear: integer("birth_year"),
  avatarUrl: text("avatar_url"),
  isActive: boolean("is_active").notNull().default(true),
  dietaryFlags: text("dietary_flags").array(),
  dislikes: text("dislikes").array(),
  preferences: text("preferences").array(),
  customNotes: text("custom_notes"),
  // Opt-in: push this member a "start cooking dinner" reminder.
  dinnerReminders: boolean("dinner_reminders").notNull().default(false),
  // Null until this member finishes or skips the welcome wizard.
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const householdsRelations = relations(households, ({ many }) => ({
  members: many(householdMembers),
}));

export const householdMembersRelations = relations(
  householdMembers,
  ({ one }) => ({
    household: one(households, {
      fields: [householdMembers.householdId],
      references: [households.id],
    }),
  })
);
