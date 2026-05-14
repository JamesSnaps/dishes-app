import {
  decimal,
  json,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { households, householdMembers } from "./households";

export const aiProviderEnum = pgEnum("ai_provider", ["openai"]);

export const aiConfigurations = pgTable("ai_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .unique()
    .references(() => households.id, { onDelete: "cascade" }),
  provider: aiProviderEnum("provider").notNull().default("openai"),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  model: varchar("model", { length: 100 }).notNull().default("gpt-4.1-nano"),
  imageModel: varchar("image_model", { length: 100 }).notNull().default("gpt-image-2"),
  defaultPrompt: text("default_prompt"),
  measurementSystem: varchar("measurement_system", { length: 20 }).notNull().default("metric"),
  monthlyLimitUsd: decimal("monthly_limit_usd", {
    precision: 8,
    scale: 2,
  }).default("20.00"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const integrationTokens = pgTable("integration_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  createdById: uuid("created_by_id").references(() => householdMembers.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 255 }).notNull(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  scopes: json("scopes").$type<string[]>().notNull().default([]),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const aiConfigurationsRelations = relations(
  aiConfigurations,
  ({ one }) => ({
    household: one(households, {
      fields: [aiConfigurations.householdId],
      references: [households.id],
    }),
  })
);

export const integrationTokensRelations = relations(
  integrationTokens,
  ({ one }) => ({
    household: one(households, {
      fields: [integrationTokens.householdId],
      references: [households.id],
    }),
    createdBy: one(householdMembers, {
      fields: [integrationTokens.createdById],
      references: [householdMembers.id],
    }),
  })
);
