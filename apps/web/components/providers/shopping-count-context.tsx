"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

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
 * badge refreshes immediately instead of waiting for the next navigation.
 */
export function notifyShoppingChanged() {
  window.dispatchEvent(new Event(SHOPPING_CHANGED_EVENT));
}

export function ShoppingCountProvider({
  initialCount,
  children,
}: {
  initialCount: number;
  children: ReactNode;
}) {
  const [count, setCount] = useState(initialCount);
  const pathname = usePathname();

  // The shopping page owns the count while it's open (offline-first via
  // Dexie, updates optimistically as items are checked off) — server
  // refreshes must not clobber it mid-sync.
  const onShoppingPage = pathname.startsWith("/shopping");
  const onShoppingPageRef = useRef(onShoppingPage);
  onShoppingPageRef.current = onShoppingPage;

  const refresh = useCallback(() => {
    if (onShoppingPageRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    fetch("/api/shopping/count")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.count === "number") setCount(data.count);
      })
      .catch(() => {
        // Offline or transient failure — keep the last known count.
      });
  }, []);

  // Re-fetch on every route change so the badge self-heals after server-side
  // mutations (recipe → list, meal plan generation, another device's changes),
  // including the first client render when the server-rendered count may be a
  // stale service-worker copy.
  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const onRefresh = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onRefresh);
    window.addEventListener("online", onRefresh);
    window.addEventListener(SHOPPING_CHANGED_EVENT, onRefresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener("online", onRefresh);
      window.removeEventListener(SHOPPING_CHANGED_EVENT, onRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return (
    <ShoppingCountContext.Provider value={{ count, setCount, refresh }}>
      {children}
    </ShoppingCountContext.Provider>
  );
}

/** Live unchecked shopping-list count, kept in sync by the shopping list view. */
export function useShoppingCount() {
  return useContext(ShoppingCountContext);
}
