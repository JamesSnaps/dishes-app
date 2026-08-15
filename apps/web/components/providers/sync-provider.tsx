"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  ApiClient,
  SessionExpiredError,
  SyncEngine,
  type SyncCollection,
  type SyncRecord,
} from "@dishes/client";
import { DexieSyncStore } from "@/lib/sync-store";

/**
 * Owns the one SyncEngine for the browser session and decides *when* to sync.
 * The engine itself has no timers or listeners by design — that policy lives
 * here, where it can differ from the native app's.
 *
 * Sync triggers: mount, regaining connectivity, the tab becoming visible again
 * (returning to an installed PWA is the common case), and route changes. No
 * polling: a household app has minutes-to-hours between changes, and a
 * background poll would cost battery for nothing.
 *
 * Route changes are here rather than at any call site because of a bug class
 * that showed up repeatedly: a server action writes to the database, the user
 * navigates to a screen that renders from the local store, and the store knows
 * nothing about the write — so the screen shows stale data and looks like the
 * write was lost. Most of the app's writes still go through server actions
 * (only shopping items and meal plan entries have sync mutations), so relying
 * on each one to remember to pull is a trap. Syncing on navigation covers all
 * of them, including the ones nobody has written yet.
 */

export type SyncState = {
  status: "idle" | "syncing" | "offline";
  lastSyncedAt: number | null;
  pending: number;
};

type SyncContextValue = SyncState & {
  /** Null during SSR and on the very first client render. */
  engine: SyncEngine | null;
  sync: () => void;
  /** Bumped after any local data change, so hooks know to re-read. */
  version: number;
};

const SyncContext = createContext<SyncContextValue | null>(null);

/** Base path, not /api/v1: the browser goes through the Authelia-gated door. */
const WEB_API_BASE = "/api/web";

export function SyncProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<SyncState>({
    status: "idle",
    lastSyncedAt: null,
    pending: 0,
  });

  // One engine for the lifetime of the tab. Created in an effect, not during
  // render: IndexedDB doesn't exist during SSR, and branching on `window`
  // mid-render would make the server and client trees differ and break
  // hydration.
  const engineRef = useRef<SyncEngine | null>(null);
  const [engine, setEngine] = useState<SyncEngine | null>(null);

  useEffect(() => {
    if (engineRef.current) return;
    engineRef.current = new SyncEngine({
      client: new ApiClient({ baseUrl: WEB_API_BASE }),
      store: new DexieSyncStore(),
      onChange: () => setVersion((v) => v + 1),
      onError: (err) => console.warn("[sync]", err),
    });
    setEngine(engineRef.current);
  }, []);

  const sync = useCallback(() => {
    if (!engine) return;

    setState((s) => ({ ...s, status: "syncing" }));

    engine
      .sync()
      .then(async (outcome) => {
        setState({
          status: outcome.offline ? "offline" : "idle",
          lastSyncedAt: outcome.offline ? null : Date.now(),
          pending: await engine.pendingCount(),
        });
      })
      .catch(async (err) => {
        // An expired Authelia session returns the login page as HTML. Reloading
        // hands the user to the portal instead of leaving the app half-dead.
        if (err instanceof SessionExpiredError) {
          window.location.reload();
          return;
        }
        const pending = await engine.pendingCount();
        setState((s) => ({ ...s, status: "offline", pending }));
      });
  }, [engine]);

  // Route changes. `sync()` coalesces concurrent runs and a delta pull with
  // nothing to report is one indexed query, so the cost of the common
  // navigate-and-nothing-changed case is negligible.
  const pathname = usePathname();

  useEffect(() => {
    if (!engine) return;
    sync();
  }, [engine, pathname, sync]);

  // Mount is covered by the route effect above, which runs on first render too.
  useEffect(() => {
    if (!engine) return;

    const onOnline = () => sync();
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [engine, sync]);

  // The provider is always rendered, so the component tree is identical on the
  // server and the client. Consumers handle a null engine.
  const value = useMemo<SyncContextValue>(
    () => ({ ...state, engine, sync, version }),
    [engine, state, sync, version]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/** Null only when rendered outside the provider. */
export function useSync(): SyncContextValue | null {
  return useContext(SyncContext);
}

/**
 * Read a whole collection from the local store.
 *
 * Returns `loading: true` only until the first read resolves — after that a
 * re-sync updates data in place rather than flashing a spinner. That is the
 * point of local-first: the screen is never empty waiting on the network.
 */
export function useSyncedCollection<T = SyncRecord>(
  collection: SyncCollection
): { data: T[]; loading: boolean } {
  const ctx = useSync();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const version = ctx?.version ?? 0;
  const engine = ctx?.engine;

  useEffect(() => {
    if (!engine) return;
    let cancelled = false;

    engine
      .read<T>(collection)
      .then((rows) => {
        if (cancelled) return;
        setData(rows);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [engine, collection, version]);

  return { data, loading };
}

/** Single record by id, same semantics as useSyncedCollection. */
export function useSyncedRecord<T = SyncRecord>(
  collection: SyncCollection,
  id: string | null | undefined
): { data: T | null; loading: boolean } {
  const ctx = useSync();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const version = ctx?.version ?? 0;
  const engine = ctx?.engine;

  useEffect(() => {
    if (!engine || !id) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    engine
      .readOne<T>(collection, id)
      .then((row) => {
        if (cancelled) return;
        setData(row);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [engine, collection, id, version]);

  return { data, loading };
}

/** Live browser connectivity, for UI that shouldn't wait for a failed sync. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true // assume online during SSR
  );
}
