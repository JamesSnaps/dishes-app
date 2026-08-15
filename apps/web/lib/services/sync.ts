/**
 * Delta sync for offline-capable clients.
 *
 * Pull is driven by `sync_changes`, an append-only log written by database
 * triggers (see `packages/db/drizzle/0025_sync_change_log.sql`). The cursor is
 * that log's `seq`, so there is no clock skew, no overlap window, and no risk
 * of a write being missed because two transactions committed out of order.
 *
 * Granularity is the aggregate root. A recipe's ingredients, steps and tags
 * roll up into a `recipe` change, so a client refetches one whole recipe rather
 * than reassembling it from child-row deltas.
 *
 * Push applies a batch of client mutations through the ordinary domain
 * services — sync is a transport, not a second implementation of the rules.
 */

import { db } from "@/lib/db";
import {
  syncChanges,
  syncOperations,
  syncPruneState,
  recipes,
  shoppingLists,
  shoppingListItems,
  mealPlans,
  mealPlanEntries,
  cookHistory,
} from "@dishes/db/schema";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { HouseholdContext, ActorContext } from "@/lib/session";
import * as shoppingService from "@/lib/services/shopping";
import * as mealPlanService from "@/lib/services/meal-plan";
import { getRecipe } from "@/lib/services/recipes";

export class SyncCursorError extends Error {
  constructor(message = "Invalid sync cursor") {
    super(message);
    this.name = "SyncCursorError";
  }
}

// --- Entities ---------------------------------------------------------------

export const SYNC_ENTITIES = [
  "recipe",
  "shopping_list",
  "shopping_item",
  "meal_plan",
  "meal_plan_entry",
  "cook_history",
] as const;

export type SyncEntity = (typeof SYNC_ENTITIES)[number];

/** Response key each entity's rows are grouped under. */
const RESPONSE_KEY: Record<SyncEntity, string> = {
  recipe: "recipes",
  shopping_list: "shoppingLists",
  shopping_item: "shoppingItems",
  meal_plan: "mealPlans",
  meal_plan_entry: "mealPlanEntries",
  cook_history: "cookHistory",
};

// --- Cursor -----------------------------------------------------------------

/**
 * Opaque, versioned cursor. Deliberately not a raw number: clients must not
 * build their own or do arithmetic on it, and the format needs room to change.
 *
 * It carries no authority — every query is scoped by the caller's household, so
 * a forged cursor can only change which of your own changes you see.
 */
export function encodeCursor(seq: bigint): string {
  return Buffer.from(`v1:${seq}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined | null): bigint {
  if (!cursor) return 0n;

  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new SyncCursorError();
  }

  const match = /^v1:(\d+)$/.exec(decoded);
  if (!match) throw new SyncCursorError();

  try {
    return BigInt(match[1]!);
  } catch {
    throw new SyncCursorError();
  }
}

// --- Pull -------------------------------------------------------------------

export type SyncPullResult = {
  cursor: string;
  hasMore: boolean;
  /** Full current rows for everything created or changed. */
  changes: Record<string, unknown[]>;
  /** Ids of things that are gone, grouped the same way. */
  deleted: Record<string, string[]>;
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/** Current max seq for this household — the watermark a full snapshot is taken at. */
async function currentSeq(householdId: string): Promise<bigint> {
  const [row] = await db
    .select({ maxSeq: sql<string | null>`max(${syncChanges.seq})` })
    .from(syncChanges)
    .where(eq(syncChanges.householdId, householdId));

  return row?.maxSeq ? BigInt(row.maxSeq) : 0n;
}

/** How far the log has been pruned for this household, or null if never. */
async function prunedThroughFor(householdId: string): Promise<bigint | null> {
  const [row] = await db
    .select({ prunedThrough: syncPruneState.prunedThrough })
    .from(syncPruneState)
    .where(eq(syncPruneState.householdId, householdId))
    .limit(1);

  return row?.prunedThrough ?? null;
}

/**
 * Fetch the current state of the given ids, per entity. Recipes come back as
 * full documents (ingredients, steps, tags); everything else is its own row.
 */
async function loadEntities(
  ctx: HouseholdContext,
  entity: SyncEntity,
  ids: string[]
): Promise<unknown[]> {
  if (!ids.length) return [];

  switch (entity) {
    case "recipe": {
      // Sequential rather than parallel: a large first sync could otherwise
      // open hundreds of concurrent connections.
      const out: unknown[] = [];
      for (const id of ids) {
        try {
          out.push(await getRecipe(ctx, id));
        } catch {
          // Deleted between the log read and now — the next pull carries the
          // tombstone, so dropping it here is correct.
        }
      }
      return out;
    }

    case "shopping_list":
      return db
        .select()
        .from(shoppingLists)
        .where(
          and(
            eq(shoppingLists.householdId, ctx.householdId),
            inArray(shoppingLists.id, ids)
          )
        );

    case "shopping_item":
      // Scoped through the parent list so a stray id can't leak another household.
      return db
        .select({ item: shoppingListItems })
        .from(shoppingListItems)
        .innerJoin(shoppingLists, eq(shoppingListItems.listId, shoppingLists.id))
        .where(
          and(
            eq(shoppingLists.householdId, ctx.householdId),
            inArray(shoppingListItems.id, ids)
          )
        )
        .then((rows) => rows.map((r) => r.item));

    case "meal_plan":
      return db
        .select()
        .from(mealPlans)
        .where(
          and(eq(mealPlans.householdId, ctx.householdId), inArray(mealPlans.id, ids))
        );

    case "meal_plan_entry":
      return db
        .select({ entry: mealPlanEntries })
        .from(mealPlanEntries)
        .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
        .where(
          and(
            eq(mealPlans.householdId, ctx.householdId),
            inArray(mealPlanEntries.id, ids)
          )
        )
        .then((rows) => rows.map((r) => r.entry));

    case "cook_history":
      return db
        .select()
        .from(cookHistory)
        .where(
          and(
            eq(cookHistory.householdId, ctx.householdId),
            inArray(cookHistory.id, ids)
          )
        );
  }
}

function emptyGrouping<T>(): Record<string, T[]> {
  return Object.fromEntries(Object.values(RESPONSE_KEY).map((k) => [k, []]));
}

/**
 * Everything the household has, at the current watermark. Used when a client
 * has no cursor — a first run, or a local store that was wiped.
 */
async function fullSnapshot(ctx: HouseholdContext): Promise<SyncPullResult> {
  const seq = await currentSeq(ctx.householdId);

  const [recipeIds, listRows, itemRows, planRows, entryRows, cookRows] =
    await Promise.all([
      db
        .select({ id: recipes.id })
        .from(recipes)
        .where(eq(recipes.householdId, ctx.householdId)),
      db.select().from(shoppingLists).where(eq(shoppingLists.householdId, ctx.householdId)),
      db
        .select({ item: shoppingListItems })
        .from(shoppingListItems)
        .innerJoin(shoppingLists, eq(shoppingListItems.listId, shoppingLists.id))
        .where(eq(shoppingLists.householdId, ctx.householdId))
        .then((rows) => rows.map((r) => r.item)),
      db.select().from(mealPlans).where(eq(mealPlans.householdId, ctx.householdId)),
      db
        .select({ entry: mealPlanEntries })
        .from(mealPlanEntries)
        .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
        .where(eq(mealPlans.householdId, ctx.householdId))
        .then((rows) => rows.map((r) => r.entry)),
      db.select().from(cookHistory).where(eq(cookHistory.householdId, ctx.householdId)),
    ]);

  const changes = emptyGrouping<unknown>();
  changes[RESPONSE_KEY.recipe] = await loadEntities(
    ctx,
    "recipe",
    recipeIds.map((r) => r.id)
  );
  changes[RESPONSE_KEY.shopping_list] = listRows;
  changes[RESPONSE_KEY.shopping_item] = itemRows;
  changes[RESPONSE_KEY.meal_plan] = planRows;
  changes[RESPONSE_KEY.meal_plan_entry] = entryRows;
  changes[RESPONSE_KEY.cook_history] = cookRows;

  return {
    cursor: encodeCursor(seq),
    hasMore: false,
    changes,
    deleted: emptyGrouping<string>(),
  };
}

export async function pull(
  ctx: HouseholdContext,
  opts: { cursor?: string | null; limit?: number } = {}
): Promise<SyncPullResult> {
  if (!opts.cursor) return fullSnapshot(ctx);

  const since = decodeCursor(opts.cursor);

  // A cursor below the prune watermark cannot be served as a delta: the rows it
  // would need are gone. Rejecting it makes the engine drop its store and take
  // a fresh snapshot, which is correct — silently serving the surviving rows
  // would leave that client permanently missing whatever was pruned.
  const prunedThrough = await prunedThroughFor(ctx.householdId);
  if (prunedThrough !== null && since < prunedThrough) {
    throw new SyncCursorError("Cursor is older than the retained change log");
  }

  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  // One extra row tells us whether another page exists without a second query.
  const rows = await db
    .select({
      seq: syncChanges.seq,
      entity: syncChanges.entity,
      entityId: syncChanges.entityId,
      op: syncChanges.op,
    })
    .from(syncChanges)
    .where(
      and(eq(syncChanges.householdId, ctx.householdId), gt(syncChanges.seq, since))
    )
    .orderBy(asc(syncChanges.seq))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  if (!page.length) {
    return {
      cursor: encodeCursor(since),
      hasMore: false,
      changes: emptyGrouping<unknown>(),
      deleted: emptyGrouping<string>(),
    };
  }

  // Collapse the log: one entity may have changed many times in the window, and
  // only its final state within the page matters. Insertion order is preserved
  // by Map, and we walk the page in seq order, so the last write wins.
  const finalOp = new Map<string, "upsert" | "delete">();
  for (const row of page) {
    finalOp.set(`${row.entity}:${row.entityId}`, row.op as "upsert" | "delete");
  }

  const upsertIds = new Map<SyncEntity, string[]>();
  const deleted = emptyGrouping<string>();

  for (const [key, op] of finalOp) {
    const idx = key.indexOf(":");
    const entity = key.slice(0, idx) as SyncEntity;
    const id = key.slice(idx + 1);

    if (!SYNC_ENTITIES.includes(entity)) continue; // unknown entity from a newer writer

    if (op === "delete") {
      deleted[RESPONSE_KEY[entity]]!.push(id);
    } else {
      const list = upsertIds.get(entity) ?? [];
      list.push(id);
      upsertIds.set(entity, list);
    }
  }

  const changes = emptyGrouping<unknown>();
  for (const [entity, ids] of upsertIds) {
    changes[RESPONSE_KEY[entity]] = await loadEntities(ctx, entity, ids);
  }

  return {
    cursor: encodeCursor(page[page.length - 1]!.seq as unknown as bigint),
    hasMore,
    changes,
    deleted,
  };
}

// --- Push -------------------------------------------------------------------

export type SyncMutation =
  | { opId: string; type: "shopping_item.add"; payload: shoppingService.AddItemInput }
  | {
      opId: string;
      type: "shopping_item.update";
      payload: { itemId: string } & shoppingService.UpdateItemInput;
    }
  | { opId: string; type: "shopping_item.toggle"; payload: { itemId: string; checked: boolean } }
  | { opId: string; type: "shopping_item.delete"; payload: { itemId: string } }
  | { opId: string; type: "shopping_list.clear_checked"; payload: { listId: string } }
  | {
      opId: string;
      type: "meal_plan_entry.add";
      payload: {
        weekStartDate: string;
        recipeId: string;
        dayOfWeek: number;
        mealType: string;
      };
    }
  | {
      opId: string;
      type: "meal_plan_entry.update";
      payload: { entryId: string; dayOfWeek?: number; mealType?: string; servings?: number | null };
    }
  | { opId: string; type: "meal_plan_entry.delete"; payload: { entryId: string } };

export type SyncMutationResult = {
  opId: string;
  status: "applied" | "duplicate" | "failed";
  error?: string;
  /** Server-assigned id, when the mutation created something. */
  id?: string;
};

/**
 * Apply one mutation. Errors are returned, not thrown: one bad operation in a
 * batch must not discard the rest, or a client with a permanently-failing
 * mutation could never drain its queue.
 */
async function applyMutation(
  ctx: ActorContext,
  mutation: SyncMutation
): Promise<Omit<SyncMutationResult, "opId" | "status">> {
  switch (mutation.type) {
    case "shopping_item.add": {
      const item = await shoppingService.addItem(ctx, mutation.payload);
      return { id: item.id };
    }
    case "shopping_item.update": {
      const { itemId, ...fields } = mutation.payload;
      await shoppingService.updateItem(ctx, itemId, fields);
      return { id: itemId };
    }
    case "shopping_item.toggle": {
      await shoppingService.toggleItem(ctx, mutation.payload.itemId, mutation.payload.checked);
      return { id: mutation.payload.itemId };
    }
    case "shopping_item.delete": {
      await shoppingService.deleteItem(ctx, mutation.payload.itemId);
      return { id: mutation.payload.itemId };
    }
    case "shopping_list.clear_checked": {
      await shoppingService.clearChecked(ctx, mutation.payload.listId);
      return { id: mutation.payload.listId };
    }
    case "meal_plan_entry.add": {
      const { weekStartDate, recipeId, dayOfWeek, mealType } = mutation.payload;
      mealPlanService.assertMealType(mealType);
      const id = await mealPlanService.addEntry(
        ctx,
        weekStartDate,
        recipeId,
        dayOfWeek,
        mealType
      );
      return { id };
    }
    case "meal_plan_entry.update": {
      const { entryId, dayOfWeek, mealType, servings } = mutation.payload;
      if (dayOfWeek !== undefined) await mealPlanService.moveEntry(ctx, entryId, dayOfWeek);
      if (mealType !== undefined) await mealPlanService.changeEntryType(ctx, entryId, mealType);
      if (servings !== undefined) {
        await mealPlanService.updateEntryServings(ctx, entryId, servings);
      }
      return { id: entryId };
    }
    case "meal_plan_entry.delete": {
      await mealPlanService.removeEntry(ctx, mutation.payload.entryId);
      return { id: mutation.payload.entryId };
    }
  }
}

export type SyncPushResult = {
  results: SyncMutationResult[];
  /** Watermark after applying, so a client can pull its own writes back cheaply. */
  cursor: string;
};

/**
 * Apply a batch in order. Mutations are applied one at a time rather than in a
 * single transaction: a client queue is a sequence of independent user actions,
 * and rolling back a whole batch because the fifth item referenced something
 * already deleted elsewhere would be wrong.
 */
export async function push(
  ctx: ActorContext,
  mutations: SyncMutation[]
): Promise<SyncPushResult> {
  const results: SyncMutationResult[] = [];

  for (const mutation of mutations) {
    // Replay protection. A queue that drains twice, or a response lost on a
    // flaky connection, must not double-apply.
    const [existing] = await db
      .select({ result: syncOperations.result })
      .from(syncOperations)
      .where(
        and(
          eq(syncOperations.opId, mutation.opId),
          eq(syncOperations.householdId, ctx.householdId)
        )
      )
      .limit(1);

    if (existing) {
      const prior = (existing.result ?? {}) as { id?: string };
      results.push({ opId: mutation.opId, status: "duplicate", id: prior.id });
      continue;
    }

    try {
      const outcome = await applyMutation(ctx, mutation);
      await db
        .insert(syncOperations)
        .values({
          opId: mutation.opId,
          householdId: ctx.householdId,
          result: outcome,
        })
        .onConflictDoNothing();

      results.push({ opId: mutation.opId, status: "applied", ...outcome });
    } catch (err) {
      // Not recorded in the ledger: a failure caused by transient state should
      // be retryable, and one caused by bad input will fail identically again.
      results.push({
        opId: mutation.opId,
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return { results, cursor: encodeCursor(await currentSeq(ctx.householdId)) };
}

// --- Retention --------------------------------------------------------------

/**
 * Days of change log to keep. A client offline for longer than this resyncs
 * from scratch on its next pull, which is the correct outcome — and for a
 * household app, a device that has not connected in a month has nothing worth
 * replaying as a delta anyway.
 */
const RETENTION_DAYS = Number(process.env.DISHES_SYNC_RETENTION_DAYS ?? 30);

/** At most one prune per process per this interval. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

/**
 * Prune opportunistically, at most hourly, without making the caller wait.
 *
 * Phase 1 has no worker and no scheduler, and a log that grows forever is a
 * real problem now rather than a hypothetical one. Piggy-backing on pull keeps
 * it to zero new infrastructure: a household that never syncs never accrues
 * rows worth pruning, and one that does gets swept within the hour. The Phase 2
 * worker should take this over — `pruneSyncLog` is exported for exactly that.
 *
 * Errors are swallowed deliberately: retention failing must never turn a
 * working sync into a failed request.
 */
export function maybePruneSyncLog(): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;

  void pruneSyncLog().catch((err) => {
    console.warn("[sync] prune failed:", err);
  });
}

export type PruneResult = {
  changesDeleted: number;
  operationsDeleted: number;
  households: number;
};

/**
 * Trim `sync_changes` and `sync_operations` to the retention window.
 *
 * The newest row per household is always kept, whatever its age. Without it a
 * quiet household would lose its entire log, and `currentSeq()` would fall back
 * to 0 — handing out a cursor that looks like "never synced" and forcing a full
 * snapshot on every client for no reason.
 *
 * Deleting from `sync_operations` is the one part with a real trade-off: an
 * opId that ages out of the ledger is no longer recognised as a replay, so a
 * client that queued a mutation and stayed offline past the window could
 * double-apply it. That needs a device to hold an undelivered mutation for the
 * whole retention window, and the same client is by then taking a full
 * snapshot anyway. Worth knowing; not worth a second mechanism.
 */
export async function pruneSyncLog(
  opts: { retentionDays?: number } = {}
): Promise<PruneResult> {
  const days = opts.retentionDays ?? RETENTION_DAYS;
  if (!Number.isFinite(days) || days <= 0) {
    return { changesDeleted: 0, operationsDeleted: 0, households: 0 };
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // One statement per concern, in a transaction: the watermark and the deletion
  // it describes must not be able to disagree.
  return db.transaction(async (tx) => {
    const deleted = await tx.execute<{
      household_id: string;
      max_seq: string;
      n: string;
    }>(sql`
      WITH newest AS (
        SELECT household_id, max(seq) AS keep_seq
        FROM sync_changes
        GROUP BY household_id
      ),
      removed AS (
        DELETE FROM sync_changes c
        USING newest n
        WHERE c.household_id = n.household_id
          AND c.changed_at < ${cutoff}
          AND c.seq < n.keep_seq
        RETURNING c.household_id, c.seq
      )
      SELECT household_id, max(seq)::text AS max_seq, count(*)::text AS n
      FROM removed
      GROUP BY household_id
    `);

    // postgres.js returns a RowList — an array, not a { rows } wrapper.
    const rows = Array.from(deleted);
    let changesDeleted = 0;

    for (const row of rows) {
      const maxSeq = BigInt(row.max_seq);
      changesDeleted += Number(row.n);

      // The watermark only ever moves forward.
      await tx
        .insert(syncPruneState)
        .values({
          householdId: row.household_id,
          prunedThrough: maxSeq,
          prunedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: syncPruneState.householdId,
          set: {
            prunedThrough: sql`greatest(${syncPruneState.prunedThrough}, ${maxSeq})`,
            prunedAt: new Date(),
          },
        });
    }

    const ops = await tx.execute(
      sql`DELETE FROM sync_operations WHERE applied_at < ${cutoff}`
    );

    return {
      changesDeleted,
      operationsDeleted: ops.count ?? 0,
      households: rows.length,
    };
  });
}
