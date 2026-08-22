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

/**
 * One optimistic local write to apply alongside a mutation.
 *
 * `temporary` marks a record the *server* will really create, held under a
 * client-generated id so the UI has something to show immediately. The engine
 * removes it once the mutation settles — see `QueuedMutation.temporary`.
 */
export type OptimisticChange = {
  collection: SyncCollection;
  record?: SyncRecord;
  removeId?: string;
  temporary?: boolean;
};

/** A queued mutation. `type` and `payload` mirror POST /api/v1/sync. */
export type QueuedMutation = {
  opId: string;
  type: string;
  payload: Record<string, unknown>;
  /** For ordering and for reporting how long something has been stuck. */
  queuedAt: number;
  /**
   * Client-generated ids written optimistically for rows the server owns.
   *
   * These must be removed once the mutation settles, whatever the outcome. On
   * success the server's row arrives in the same cycle's pull under its *real*
   * id, and `applyPull` only deletes ids the server reports as deleted — so a
   * temporary row left behind would never be cleaned up and the entity would
   * appear twice, permanently. On failure it is simply the rollback.
   *
   * Persisted with the mutation so a reload mid-flight doesn't strand them.
   */
  temporary?: { collection: SyncCollection; id: string }[];
};

/**
 * A mutation the server refused, reported so the host can tell the user.
 *
 * The engine drops these rather than retrying — the server records no ledger
 * entry for a failure, so a transient one would have succeeded on the next
 * attempt, and a persistent one is bad input that never will. Dropping is
 * right; dropping *silently* is not. The optimistic change has already been
 * rolled back by the time this is reported, so from the user's side something
 * they did has just undone itself, and this is the only chance to say why.
 */
export type FailedMutation = {
  opId: string;
  /** The mutation type, e.g. "meal_plan_entry.add". */
  type: string;
  payload: Record<string, unknown>;
  /** The server's message. Not written for end users. */
  error: string;
  /** When the user actually performed the action. */
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
/**
 * The request timed out or was aborted before the server answered.
 *
 * Distinct from ApiError on purpose: a timeout says nothing about the request
 * being wrong, only that the connection could not carry it right now. The sync
 * engine backs off on these rather than retrying at full rate, which is what
 * stops a weak signal from turning every navigation into another stalled
 * request.
 */
export class NetworkTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "NetworkTimeoutError";
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired — reload to sign in again");
    this.name = "SessionExpiredError";
  }
}
