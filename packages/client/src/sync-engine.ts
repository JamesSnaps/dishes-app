import type { ApiClient } from "./api";
import {
  ApiError,
  NetworkTimeoutError,
  SessionExpiredError,
  SYNC_COLLECTIONS,
  type OptimisticChange,
  type FailedMutation,
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
  /**
   * Fired when the server refuses queued mutations, once per batch. The
   * optimistic changes have already been rolled back — the host's job is to
   * explain what just reverted. Separate from `onError`, which is for transport
   * failures the user doesn't need to hear about.
   */
  onMutationsFailed?: (failures: FailedMutation[]) => void;
};

export type SyncOutcome = {
  pulled: number;
  pushed: number;
  failed: number;
  /** True when nothing could reach the server. */
  offline: boolean;
  /** True when this call was skipped because we are backing off. */
  skipped?: boolean;
};

export class SyncEngine {
  private readonly client: ApiClient;
  private readonly store: SyncStore;
  private readonly pageSize: number;
  private readonly onError?: (err: unknown) => void;
  private readonly onChange?: () => void;
  private readonly onMutationsFailed?: (failures: FailedMutation[]) => void;

  /** Guards against two syncs interleaving and double-draining the queue. */
  private inFlight: Promise<SyncOutcome> | null = null;

  constructor(opts: SyncEngineOptions) {
    this.client = opts.client;
    this.store = opts.store;
    this.pageSize = opts.pageSize ?? 500;
    this.onError = opts.onError;
    this.onChange = opts.onChange;
    this.onMutationsFailed = opts.onMutationsFailed;
  }

  /**
   * Backoff after a failed attempt.
   *
   * The problem this solves is a weak signal rather than no signal. With no
   * signal, requests fail instantly and cost nothing. With one bar,
   * `navigator.onLine` is still true, so every navigation used to fire another
   * request that would hang — each one holding a connection and competing for
   * a few KB/s, so a bad connection produced *more* traffic, not less.
   *
   * Doubling from 5s to a 5 minute ceiling. Any success resets it, and an
   * explicit user request (`force`) ignores it entirely — if someone taps
   * "sync now", they get an attempt regardless.
   */
  private static readonly BACKOFF_MIN_MS = 5_000;
  private static readonly BACKOFF_MAX_MS = 5 * 60_000;
  private backoffMs = 0;
  private nextAttemptAt = 0;

  /** Whether a non-forced sync would currently be skipped. */
  get isBackingOff(): boolean {
    return Date.now() < this.nextAttemptAt;
  }

  /**
   * Push queued mutations, then pull. That order matters: pushing first means
   * the pull returns our own writes in their server-canonical form, so local
   * optimistic copies are reconciled in the same cycle.
   *
   * Concurrent calls share one run rather than queueing another.
   */
  sync(opts: { force?: boolean } = {}): Promise<SyncOutcome> {
    if (this.inFlight) return this.inFlight;

    if (!opts.force && this.isBackingOff) {
      return Promise.resolve({
        pulled: 0,
        pushed: 0,
        failed: 0,
        offline: true,
        skipped: true,
      });
    }

    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private noteSuccess(): void {
    this.backoffMs = 0;
    this.nextAttemptAt = 0;
  }

  private noteFailure(): void {
    this.backoffMs = this.backoffMs
      ? Math.min(this.backoffMs * 2, SyncEngine.BACKOFF_MAX_MS)
      : SyncEngine.BACKOFF_MIN_MS;
    this.nextAttemptAt = Date.now() + this.backoffMs;
  }

  private async run(): Promise<SyncOutcome> {
    const outcome: SyncOutcome = { pulled: 0, pushed: 0, failed: 0, offline: false };

    try {
      const pushResult = await this.drainQueue();
      outcome.pushed = pushResult.pushed;
      outcome.failed = pushResult.failed;

      outcome.pulled = await this.pullAll();
      this.noteSuccess();
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err; // host must handle

      // Timeouts and transport failures mean "the connection could not carry
      // this", so slow down. A 4xx/5xx means we reached the server, so the
      // connection is fine and backing off would only delay recovery.
      if (err instanceof NetworkTimeoutError || !(err instanceof ApiError)) {
        this.noteFailure();
      }

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

      // Optional chaining, not indexing: a server that adds a collection this
      // client doesn't know about (or omits one) would otherwise throw here,
      // and the catch upstream reports that as "offline" — an app that looks
      // disconnected while the network is fine, with no way out.
      total += SYNC_COLLECTIONS.reduce(
        (n, c) => n + (page.changes[c]?.length ?? 0) + (page.deleted[c]?.length ?? 0),
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

    // After the rollback and the dequeue: by the time the host hears about
    // this, the local state it describes is already the state on screen.
    if (failed.length) {
      this.onMutationsFailed?.(
        failed.map((f) => {
          const original = byOpId.get(f.opId);
          return {
            opId: f.opId,
            type: original?.type ?? "unknown",
            payload: original?.payload ?? {},
            error: f.error ?? "Unknown error",
            queuedAt: original?.queuedAt ?? Date.now(),
          };
        })
      );
    }

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

  /**
   * Patch a record in the local store without queueing anything.
   *
   * For writes that still go through a server action rather than a sync
   * mutation — most of the app, since push only covers shopping items and meal
   * plan entries. The server has already been told (or is about to be); this
   * just stops the screen showing the old value until the next pull lands.
   *
   * The next pull overwrites whatever is written here with the server's row, so
   * a patch the server ends up rejecting corrects itself with no rollback
   * bookkeeping. Use it only where the server's answer is a foregone conclusion
   * — flipping a flag, not anything the server might compute differently.
   */
  async patchLocal(
    collection: SyncCollection,
    id: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    const existing = await this.store.readOne(collection, id);
    if (!existing) return;

    await this.store.put(collection, { ...existing, ...patch, id });
    this.onChange?.();
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
