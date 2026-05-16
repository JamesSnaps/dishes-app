import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households, householdMembers } from "./households";
import { recipes } from "./recipes";

export const shareTokens = pgTable("share_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  createdById: uuid("created_by_id").references(() => householdMembers.id, {
    onDelete: "set null",
  }),
  token: varchar("token", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at"),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const smtpConfigurations = pgTable("smtp_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .unique()
    .references(() => households.id, { onDelete: "cascade" }),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(587),
  username: varchar("username", { length: 255 }).notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  fromAddress: varchar("from_address", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const shareTokensRelations = relations(shareTokens, ({ one }) => ({
  household: one(households, {
    fields: [shareTokens.householdId],
    references: [households.id],
  }),
  recipe: one(recipes, {
    fields: [shareTokens.recipeId],
    references: [recipes.id],
  }),
  createdBy: one(householdMembers, {
    fields: [shareTokens.createdById],
    references: [householdMembers.id],
  }),
}));

export const smtpConfigurationsRelations = relations(
  smtpConfigurations,
  ({ one }) => ({
    household: one(households, {
      fields: [smtpConfigurations.householdId],
      references: [households.id],
    }),
  })
);
