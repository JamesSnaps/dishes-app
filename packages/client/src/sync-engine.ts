import type { ApiClient } from "./api";
import {
  ApiError,
  SessionExpiredError,
  SYNC_COLLECTIONS,
  type QueuedMutation,
  type SyncCollection,
  type SyncRecord,
  type SyncStore,
} from "./types";

/**
 * Drives the local store from the server and back.
 *
 * Deliberately has no timers, no network listeners and no React. The host
 * decides *when* to sync — on mount, on reconnect, on app resume, on a
 * background task — and calls `sync()`. That keeps this testable and identical
 * across web and native.
 */

export type SyncEngineOptions = {
  client: ApiClient;
  store: SyncStore;
  /** Page size for pulls. The server caps at 1000. */
  pageSize?: number;
  onError?: (err: unknown) => void;
  /** Fired after any change to local data, so a host can re-render. */
  onChange?: () => void;
};

export type SyncOutcome = {
  pulled: number;
  pushed: number;
  failed: number;
  /** True when nothing could reach the server. */
  offline: boolean;
};

export class SyncEngine {
  private readonly client: ApiClient;
  private readonly store: SyncStore;
  private readonly pageSize: number;
  private readonly onError?: (err: unknown) => void;
  private readonly onChange?: () => void;

  /** Guards against two syncs interleaving and double-draining the queue. */
  private inFlight: Promise<SyncOutcome> | null = null;

  constructor(opts: SyncEngineOptions) {
    this.client = opts.client;
    this.store = opts.store;
    this.pageSize = opts.pageSize ?? 500;
    this.onError = opts.onError;
    this.onChange = opts.onChange;
  }

  /**
   * Push queued mutations, then pull. That order matters: pushing first means
   * the pull returns our own writes in their server-canonical form, so local
   * optimistic copies are reconciled in the same cycle.
   *
   * Concurrent calls share one run rather than queueing another.
   */
  sync(): Promise<SyncOutcome> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<SyncOutcome> {
    const outcome: SyncOutcome = { pulled: 0, pushed: 0, failed: 0, offline: false };

    try {
      const pushResult = await this.drainQueue();
      outcome.pushed = pushResult.pushed;
      outcome.failed = pushResult.failed;

      outcome.pulled = await this.pullAll();
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err; // host must handle
      outcome.offline = true;
      this.onError?.(err);
    }

    if (outcome.pulled || outcome.pushed) this.onChange?.();
    return outcome;
  }

  // --- Pull -----------------------------------------------------------------

  private async pullAll(): Promise<number> {
    let total = 0;
    let guard = 0;

    for (;;) {
      const cursor = await this.store.getCursor();

      let page;
      try {
        page = await this.client.pull(cursor, this.pageSize);
      } catch (err) {
        // A cursor the server won't accept (format change, or a log pruned
        // past it) is recoverable exactly once: drop everything and take a
        // fresh snapshot. Looping on it would be an infinite reset.
        if (err instanceof ApiError && err.code === "invalid_request" && cursor) {
          await this.store.clear();
          continue;
        }
        throw err;
      }

      await this.store.applyPull(page.changes, page.deleted, page.cursor);

      total += SYNC_COLLECTIONS.reduce(
        (n, c) => n + page.changes[c].length + page.deleted[c].length,
        0
      );

      if (!page.hasMore) break;

      // A server that always claims hasMore would spin forever.
      if (++guard > 200) break;
    }

    return total;
  }

  // --- Push -----------------------------------------------------------------

  private async drainQueue(): Promise<{ pushed: number; failed: number }> {
    const pending = await this.store.pendingMutations();
    if (!pending.length) return { pushed: 0, failed: 0 };

    const response = await this.client.push(pending);

    // 'duplicate' means the server already has it — as settled as 'applied'.
    // 'failed' is dropped rather than retried forever: the server records no
    // ledger entry for a failure, so a transient one would have succeeded on
    // the next attempt; a persistent one is bad input that will never succeed,
    // and keeping it would block every mutation behind it.
    const settled = response.results
      .filter((r) => r.status === "applied" || r.status === "duplicate")
      .map((r) => r.opId);

    const failed = response.results.filter((r) => r.status === "failed");
    for (const f of failed) this.onError?.(new Error(`${f.opId}: ${f.error}`));

    await this.store.dequeue([...settled, ...failed.map((f) => f.opId)]);

    return { pushed: settled.length, failed: failed.length };
  }

  // --- Local writes ---------------------------------------------------------

  /**
   * Record a mutation locally and queue it. Applies the optimistic local change
   * first so the UI updates immediately, then lets the next sync reconcile.
   */
  async mutate(
    type: string,
    payload: Record<string, unknown>,
    optimistic?: { collection: SyncCollection; record?: SyncRecord; removeId?: string }
  ): Promise<string> {
    const opId = crypto.randomUUID();

    if (optimistic?.record) {
      await this.store.put(optimistic.collection, optimistic.record);
    } else if (optimistic?.removeId) {
      await this.store.remove(optimistic.collection, optimistic.removeId);
    }

    const mutation: QueuedMutation = { opId, type, payload, queuedAt: Date.now() };
    await this.store.enqueue(mutation);
    this.onChange?.();

    return opId;
  }

  // --- Reads ----------------------------------------------------------------

  read<T = SyncRecord>(collection: SyncCollection) {
    return this.store.read<T>(collection);
  }

  readOne<T = SyncRecord>(collection: SyncCollection, id: string) {
    return this.store.readOne<T>(collection, id);
  }

  pendingCount() {
    return this.store.pendingMutations().then((m) => m.length);
  }
}
