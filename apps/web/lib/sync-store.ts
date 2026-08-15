"use client";

import Dexie, { type Table } from "dexie";
import {
  SYNC_COLLECTIONS,
  type QueuedMutation,
  type SyncCollection,
  type SyncRecord,
  type SyncStore,
} from "@dishes/client";

/**
 * IndexedDB-backed SyncStore for the browser.
 *
 * One table per collection rather than a single polymorphic table, so a read of
 * "all recipes" is an index scan rather than a filter over everything.
 *
 * Separate from `lib/shopping-db.ts`, which is the older shopping-only offline
 * cache. That one stays until its screens move across — two stores briefly is
 * better than a migration that has to land atomically with a UI rewrite.
 */

const CURSOR_KEY = "cursor";

class DishesSyncDB extends Dexie {
  recipes!: Table<SyncRecord, string>;
  shoppingLists!: Table<SyncRecord, string>;
  shoppingItems!: Table<SyncRecord, string>;
  mealPlans!: Table<SyncRecord, string>;
  mealPlanEntries!: Table<SyncRecord, string>;
  cookHistory!: Table<SyncRecord, string>;
  meta!: Table<{ key: string; value: string }, string>;
  queue!: Table<QueuedMutation, string>;

  constructor() {
    super("dishes-sync");
    this.version(1).stores({
      recipes: "id, title",
      shoppingLists: "id",
      shoppingItems: "id, listId, position",
      mealPlans: "id, weekStartDate",
      mealPlanEntries: "id, mealPlanId, dayOfWeek",
      cookHistory: "id, recipeId, cookedAt",
      meta: "key",
      queue: "opId, queuedAt",
    });
  }

  table_(collection: SyncCollection): Table<SyncRecord, string> {
    return this[collection];
  }
}

export class DexieSyncStore implements SyncStore {
  private readonly db = new DishesSyncDB();

  async getCursor(): Promise<string | null> {
    const row = await this.db.meta.get(CURSOR_KEY);
    return row?.value ?? null;
  }

  async setCursor(cursor: string): Promise<void> {
    await this.db.meta.put({ key: CURSOR_KEY, value: cursor });
  }

  /**
   * One transaction across every table plus the cursor. A half-applied page
   * with a saved cursor would silently drop those records forever, since the
   * next pull starts after them.
   */
  async applyPull(
    changes: Record<SyncCollection, SyncRecord[]>,
    deleted: Record<SyncCollection, string[]>,
    cursor: string
  ): Promise<void> {
    const tables = SYNC_COLLECTIONS.map((c) => this.db.table_(c));

    await this.db.transaction("rw", [...tables, this.db.meta], async () => {
      for (const collection of SYNC_COLLECTIONS) {
        const table = this.db.table_(collection);
        const upserts = changes[collection];
        const removals = deleted[collection];

        if (upserts?.length) await table.bulkPut(upserts);
        if (removals?.length) await table.bulkDelete(removals);
      }
      await this.db.meta.put({ key: CURSOR_KEY, value: cursor });
    });
  }

  async read<T = SyncRecord>(collection: SyncCollection): Promise<T[]> {
    return (await this.db.table_(collection).toArray()) as T[];
  }

  async readOne<T = SyncRecord>(
    collection: SyncCollection,
    id: string
  ): Promise<T | null> {
    return ((await this.db.table_(collection).get(id)) as T) ?? null;
  }

  async put(collection: SyncCollection, record: SyncRecord): Promise<void> {
    await this.db.table_(collection).put(record);
  }

  async remove(collection: SyncCollection, id: string): Promise<void> {
    await this.db.table_(collection).delete(id);
  }

  async enqueue(mutation: QueuedMutation): Promise<void> {
    await this.db.queue.put(mutation);
  }

  async pendingMutations(): Promise<QueuedMutation[]> {
    // Queue order is user-action order, and the server applies it as given.
    return this.db.queue.orderBy("queuedAt").toArray();
  }

  async dequeue(opIds: string[]): Promise<void> {
    if (!opIds.length) return;
    await this.db.queue.bulkDelete(opIds);
  }

  /** Wipes cached data and the cursor, but NOT the queue — unsent user writes
   * must survive a forced resnapshot. */
  async clear(): Promise<void> {
    const tables = SYNC_COLLECTIONS.map((c) => this.db.table_(c));
    await this.db.transaction("rw", [...tables, this.db.meta], async () => {
      for (const table of tables) await table.clear();
      await this.db.meta.delete(CURSOR_KEY);
    });
  }
}
