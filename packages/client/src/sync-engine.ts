import type { ApiClient } from "./api";
import {
  ApiError,
  SessionExpiredError,
  SYNC_COLLECTIONS,
  type OptimisticChange,
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

    // Drop every temporary row the settled mutations created, whatever the
    // outcome. Applied or duplicate: the server's own row arrives in this same
    // cycle's pull, under its real id, and leaving the placeholder would show
    // the entity twice forever. Failed: this is the rollback.
    //
    // Before the dequeue, so a crash in between leaves the mutation queued and
    // the placeholder intact rather than the other way round.
    const byOpId = new Map(pending.map((m) => [m.opId, m]));
    for (const result of response.results) {
      const temporary = byOpId.get(result.opId)?.temporary;
      if (!temporary) continue;
      for (const row of temporary) {
        await this.store.remove(row.collection, row.id);
      }
    }

    await this.store.dequeue([...settled, ...failed.map((f) => f.opId)]);

    return { pushed: settled.length, failed: failed.length };
  }

  // --- Local writes ---------------------------------------------------------

  /**
   * Record a mutation locally and queue it. Applies the optimistic local
   * changes first so the UI updates immediately, then lets the next sync
   * reconcile.
   *
   * A change marked `temporary` is one the server will really create: it is
   * written under a client-generated id so the UI has something to show, and
   * removed again when the mutation settles. That is what makes optimistic
   * *creates* safe — see `QueuedMutation.temporary`.
   */
  async mutate(
    type: string,
    payload: Record<string, unknown>,
    optimistic: OptimisticChange[] = []
  ): Promise<string> {
    const opId = crypto.randomUUID();
    const temporary: { collection: SyncCollection; id: string }[] = [];

    for (const change of optimistic) {
      if (change.record) {
        await this.store.put(change.collection, change.record);
        if (change.temporary) {
          temporary.push({ collection: change.collection, id: change.record.id });
        }
      } else if (change.removeId) {
        await this.store.remove(change.collection, change.removeId);
      }
    }

    const mutation: QueuedMutation = {
      opId,
      type,
      payload,
      queuedAt: Date.now(),
      ...(temporary.length ? { temporary } : {}),
    };

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
