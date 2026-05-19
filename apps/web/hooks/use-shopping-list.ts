"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { shoppingDB, type CachedShoppingItem } from "@/lib/shopping-db";

export type ShoppingItem = CachedShoppingItem;

interface UseShoppingListReturn {
  items: ShoppingItem[];
  toggle: (itemId: string, checked: boolean) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  add: (data: {
    ingredientName: string;
    amount: string | null;
    unit: string | null;
    category: string | null;
    notes: string | null;
  }) => Promise<void>;
  clearCheckedLocal: () => void;
  pendingCount: number;
  isSyncing: boolean;
}

export function useShoppingList(
  initialItems: ShoppingItem[],
  listId: string | null
): UseShoppingListReturn {
  const [items, setItems] = useState<ShoppingItem[]>(initialItems);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const flushingRef = useRef(false);

  useEffect(() => {
    if (!listId) return;

    async function hydrate() {
      if (initialItems.length > 0) {
        await shoppingDB.items.bulkPut(initialItems);
      }

      // Remove items from old lists so IDB doesn't grow unboundedly
      await shoppingDB.items
        .filter((i) => i.listId !== listId)
        .delete();

      const cached = await shoppingDB.items
        .where("listId")
        .equals(listId!)
        .sortBy("position");
      if (cached.length > 0) {
        setItems(cached);
      }

      const count = await shoppingDB.pendingMutations.count();
      setPendingCount(count);
    }

    hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  const flushPending = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setIsSyncing(true);

    try {
      const mutations = await shoppingDB.pendingMutations
        .orderBy("createdAt")
        .toArray();

      for (const mutation of mutations) {
        try {
          const res = await fetch(mutation.url, {
            method: mutation.method,
            headers: { "Content-Type": "application/json" },
            body: mutation.body || undefined,
          });
          if (res.ok || (res.status >= 400 && res.status < 500)) {
            // Drop on success or 4xx (item gone, bad request) — don't block the queue
            await shoppingDB.pendingMutations.delete(mutation.id!);
          } else {
            // 5xx or network error — stop and let the next online event retry
            break;
          }
        } catch {
          // Network failure — stop flushing
          break;
        }
      }

      // Re-sync canonical state from server after flushing
      const res = await fetch("/api/shopping/active");
      if (res.ok) {
        const data = await res.json();
        if (data.listId) {
          await shoppingDB.items.where("listId").equals(data.listId).delete();
          await shoppingDB.items.bulkPut(data.items);
          setItems(data.items);
        }
      }
    } finally {
      flushingRef.current = false;
      setIsSyncing(false);
      const count = await shoppingDB.pendingMutations.count();
      setPendingCount(count);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("online", flushPending);
    return () => window.removeEventListener("online", flushPending);
  }, [flushPending]);

  async function registerSync() {
    if ("serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if ("sync" in reg) {
          await (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register("sync-shopping");
        }
      } catch {
        // Background Sync not available — online event is the fallback
      }
    }
  }

  const toggle = useCallback(
    async (itemId: string, checked: boolean) => {
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, isChecked: checked } : i))
      );
      await shoppingDB.items.update(itemId, { isChecked: checked });

      const url = `/api/shopping/items/${itemId}/toggle`;
      const body = JSON.stringify({ checked });

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!res.ok) throw new Error("toggle failed");
      } catch {
        await shoppingDB.pendingMutations.add({
          url,
          method: "POST",
          body,
          createdAt: Date.now(),
        });
        const count = await shoppingDB.pendingMutations.count();
        setPendingCount(count);
        registerSync();
      }
    },
    []
  );

  const remove = useCallback(async (itemId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    await shoppingDB.items.delete(itemId);

    const url = `/api/shopping/items/${itemId}`;

    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      await shoppingDB.pendingMutations.add({
        url,
        method: "DELETE",
        body: "",
        createdAt: Date.now(),
      });
      const count = await shoppingDB.pendingMutations.count();
      setPendingCount(count);
      registerSync();
    }
  }, []);

  const add = useCallback(
    async (data: {
      ingredientName: string;
      amount: string | null;
      unit: string | null;
      category: string | null;
      notes: string | null;
    }) => {
      if (!listId) return;

      const id = crypto.randomUUID();
      const maxPos =
        items.length > 0 ? Math.max(...items.map((i) => i.position)) : -1;

      const newItem: ShoppingItem = {
        id,
        listId,
        ...data,
        isChecked: false,
        position: maxPos + 1,
        recipeId: null,
        recipeTitle: null,
      };

      setItems((prev) => [...prev, newItem]);
      await shoppingDB.items.put(newItem);

      const url = "/api/shopping/items";
      const body = JSON.stringify({ id, listId, ...data, position: maxPos + 1 });

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!res.ok) throw new Error("add failed");
      } catch {
        await shoppingDB.pendingMutations.add({
          url,
          method: "POST",
          body,
          createdAt: Date.now(),
        });
        const count = await shoppingDB.pendingMutations.count();
        setPendingCount(count);
        registerSync();
      }
    },
    [listId, items]
  );

  const clearCheckedLocal = useCallback(() => {
    setItems((prev) => prev.filter((i) => !i.isChecked));
    if (listId) {
      shoppingDB.items
        .where("listId")
        .equals(listId)
        .filter((i) => i.isChecked)
        .delete();
    }
  }, [listId]);

  return {
    items,
    toggle,
    remove,
    add,
    clearCheckedLocal,
    pendingCount,
    isSyncing,
  };
}
