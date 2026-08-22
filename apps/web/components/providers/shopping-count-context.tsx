"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useSync, useSyncedCollection } from "@/components/providers/sync-provider";

interface ShoppingCountValue {
  count: number;
  setCount: (n: number) => void;
  refresh: () => void;
}

const ShoppingCountContext = createContext<ShoppingCountValue | null>(null);

const SHOPPING_CHANGED_EVENT = "dishes-shopping-changed";

/**
 * Call after any client-side mutation that changes the shopping list from
 * outside the shopping page (e.g. adding a recipe's ingredients) so the nav
 * badge updates immediately.
 *
 * Kept for call sites that write through server actions: those don't touch the
 * local store, so the badge needs a nudge to re-read after the sync lands.
 */
export function notifyShoppingChanged() {
  window.dispatchEvent(new Event(SHOPPING_CHANGED_EVENT));
}

type SyncRow = Record<string, unknown> & { id: string };

/**
 * Unchecked items on the oldest active list — the same list, and the same rule,
 * as the `/api/shopping/count` query it replaces.
 */
function countFromStore(lists: SyncRow[], items: SyncRow[]): number | null {
  const active = lists
    .filter((l) => l.status === "active")
    .sort((a, b) =>
      String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
    )[0];

  if (!active) return null;
  return items.filter((i) => i.listId === active.id && i.isChecked !== true).length;
}

/**
 * The nav badge, derived from the local store.
 *
 * This used to fetch `/api/shopping/count` on every route change. On a good
 * connection that was invisible; on a weak one it was a guaranteed extra round
 * trip per navigation, with no timeout, competing for bandwidth with the RSC
 * payload and the sync pull. The data was already being synced — the badge was
 * paying for a network request to learn something the device knew.
 *
 * The server's count is still the first paint (`initialCount`), so the badge is
 * correct before the store is populated and on a device with no local data.
 */
export function ShoppingCountProvider({
  initialCount,
  children,
}: {
  initialCount: number;
  children: ReactNode;
}) {
  const sync = useSync();
  const pathname = usePathname();

  const { data: lists } = useSyncedCollection<SyncRow>("shoppingLists");
  const { data: items } = useSyncedCollection<SyncRow>("shoppingItems");

  // The shopping page owns the count while it's open — it updates optimistically
  // as items are ticked off, and must not be overwritten mid-interaction.
  const onShoppingPage = pathname.startsWith("/shopping");

  // Set only by the shopping page via setCount; null means "derive it".
  const [override, setOverride] = useState<number | null>(null);
  const overrideRef = useRef(override);
  overrideRef.current = override;

  // Leaving the shopping page hands ownership back to the store.
  useEffect(() => {
    if (!onShoppingPage) setOverride(null);
  }, [onShoppingPage]);

  const derived = sync?.engine ? countFromStore(lists, items) : null;

  const count = override ?? derived ?? initialCount;

  const setCount = useCallback((n: number) => setOverride(n), []);

  /**
   * A forced sync, then the derived count follows automatically. Kept as the
   * public `refresh` so existing call sites keep working — they now trigger a
   * sync rather than a bespoke count fetch.
   */
  const refresh = useCallback(() => {
    if (overrideRef.current !== null) return;
    sync?.sync();
  }, [sync]);

  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener(SHOPPING_CHANGED_EVENT, onRefresh);
    return () => window.removeEventListener(SHOPPING_CHANGED_EVENT, onRefresh);
  }, [refresh]);

  // No route-change / focus / visibility listeners here any more: the sync
  // provider already syncs on all three, and the badge re-derives whenever the
  // store changes. Duplicating them just meant two requests where one would do.

  const value = useMemo(
    () => ({ count, setCount, refresh }),
    [count, setCount, refresh]
  );

  return (
    <ShoppingCountContext.Provider value={value}>
      {children}
    </ShoppingCountContext.Provider>
  );
}

/** Live unchecked shopping-list count, derived from the synced local store. */
export function useShoppingCount() {
  return useContext(ShoppingCountContext);
}
