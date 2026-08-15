import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  bigserial,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * Append-only change log, written by database triggers (see
 * `drizzle/0025_sync_change_log.sql`). Nothing in the app writes to this table;
 * it is populated by triggers so that any write — server action, REST route,
 * future worker, or a manual psql fix — is captured without the app having to
 * remember.
 *
 * `seq` is the sync cursor. A sequence rather than a timestamp, so clock skew
 * and concurrent-transaction visibility are non-issues.
 *
 * Granularity is the aggregate root: editing an ingredient logs a change
 * against its recipe, not against the ingredient row.
 */
export const syncChanges = pgTable(
  "sync_changes",
  {
    seq: bigserial("seq", { mode: "bigint" }).primaryKey(),
    householdId: uuid("household_id").notNull(),
    /** 'recipe' | 'shopping_list' | 'shopping_item' | 'meal_plan' | 'meal_plan_entry' | 'cook_history' */
    entity: varchar("entity", { length: 40 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    /** 'upsert' | 'delete' */
    op: varchar("op", { length: 10 }).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_changes_household_seq_idx").on(t.householdId, t.seq)]
);

/**
 * How far the change log has been pruned, per household.
 *
 * Pruning without this would be silently wrong: a client whose cursor sits
 * below the pruned range would ask for everything after it, receive only the
 * surviving rows, and never learn the rest existed. `pull()` compares the
 * incoming cursor against `prunedThrough` and rejects anything older, which the
 * sync engine turns into a full resnapshot.
 */
export const syncPruneState = pgTable("sync_prune_state", {
  householdId: uuid("household_id").primaryKey(),
  /** Highest seq deleted for this household. Cursors below it have holes. */
  prunedThrough: bigint("pruned_through", { mode: "bigint" }).notNull(),
  prunedAt: timestamp("pruned_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Idempotency ledger for uploaded mutations. A client generates an opId per
 * mutation and may replay it freely — a queue that drains twice, or a response
 * lost on a flaky connection, must not double-apply.
 */
export const syncOperations = pgTable(
  "sync_operations",
  {
    opId: uuid("op_id").primaryKey(),
    householdId: uuid("household_id").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    result: jsonb("result"),
  },
  (t) => [index("sync_operations_household_idx").on(t.householdId, t.appliedAt)]
);
