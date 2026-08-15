/**
 * Wire types for the Dishes client API, and the contracts a host platform must
 * satisfy to use the sync engine.
 *
 * This package is deliberately platform-agnostic: no Dexie, no expo-sqlite, no
 * React. The web app supplies an IndexedDB-backed store; a native app will
 * supply a SQLite-backed one. Everything above the adapter is shared.
 */

/** The entity groupings the sync endpoint returns. */
export type SyncCollection =
  | "recipes"
  | "shoppingLists"
  | "shoppingItems"
  | "mealPlans"
  | "mealPlanEntries"
  | "cookHistory";

export const SYNC_COLLECTIONS: SyncCollection[] = [
  "recipes",
  "shoppingLists",
  "shoppingItems",
  "mealPlans",
  "mealPlanEntries",
  "cookHistory",
];

/** Anything syncable has an id; the engine needs nothing else. */
export type SyncRecord = { id: string } & Record<string, unknown>;

export type SyncPullResponse = {
  cursor: string;
  hasMore: boolean;
  changes: Record<SyncCollection, SyncRecord[]>;
  deleted: Record<SyncCollection, string[]>;
};

export type MutationStatus = "applied" | "duplicate" | "failed";

export type MutationResult = {
  opId: string;
  status: MutationStatus;
  error?: string;
  id?: string;
};

export type SyncPushResponse = { results: MutationResult[]; cursor: string };

/** A queued mutation. `type` and `payload` mirror POST /api/v1/sync. */
export type QueuedMutation = {
  opId: string;
  type: string;
  payload: Record<string, unknown>;
  /** For ordering and for reporting how long something has been stuck. */
  queuedAt: number;
};

/**
 * Local persistence the engine drives. Implement this once per platform.
 *
 * Implementations must be safe to call concurrently, and `applyPull` should be
 * atomic where the platform allows it — a half-applied page would leave the
 * store inconsistent with the saved cursor.
 */
export interface SyncStore {
  getCursor(): Promise<string | null>;
  setCursor(cursor: string): Promise<void>;

  /** Upsert changed records and remove deleted ids, then save the cursor. */
  applyPull(
    changes: Record<SyncCollection, SyncRecord[]>,
    deleted: Record<SyncCollection, string[]>,
    cursor: string
  ): Promise<void>;

  read<T = SyncRecord>(collection: SyncCollection): Promise<T[]>;
  readOne<T = SyncRecord>(collection: SyncCollection, id: string): Promise<T | null>;

  /** Optimistic local write, replaced by the server's version on the next pull. */
  put(collection: SyncCollection, record: SyncRecord): Promise<void>;
  remove(collection: SyncCollection, id: string): Promise<void>;

  enqueue(mutation: QueuedMutation): Promise<void>;
  pendingMutations(): Promise<QueuedMutation[]>;
  dequeue(opIds: string[]): Promise<void>;

  /** Wipe everything — used when the server reports an unusable cursor. */
  clear(): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Thrown when a response isn't JSON. On the web this almost always means an
 * expired Authelia session redirected the request to the login portal, so the
 * host should reload rather than try to parse it.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired — reload to sign in again");
    this.name = "SessionExpiredError";
  }
}
