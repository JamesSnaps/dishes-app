"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { shoppingDB, type CachedShoppingItem } from "@/lib/shopping-db";

export type ShoppingItem = CachedShoppingItem;

/**
 * A local change that the server has not confirmed yet.
 *
 * Every server snapshot we receive — on mount, and on every resume — is older
 * than whatever the user just did on this device. Without a record of the
 * in-flight work, applying a snapshot silently reverts it: tick six things off
 * in the aisle, switch to the supermarket's own app, switch back, and the
 * resume handler overwrites all six with the state the server had before they
 * landed. `inflight` counts requests still in the air, `queued` counts ones
 * parked in the offline queue; the entry survives until both reach zero, and
 * until then it is re-applied over anything the server says.
 */
type PendingOp = {
  patch: Partial<ShoppingItem>;
  deleted: boolean;
  added: ShoppingItem | null;
  inflight: number;
  queued: number;
};

interface UseShoppingListReturn {
  items: ShoppingItem[];
  toggle: (itemId: string, checked: boolean) => Promise<void>;
  update: (
    itemId: string,
    data: {
      ingredientName?: string;
      amount?: string | null;
      unit?: string | null;
      notes?: string | null;
    }
  ) => Promise<void>;
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
  const pendingOpsRef = useRef(new Map<string, PendingOp>());

  const getOp = useCallback((itemId: string): PendingOp => {
    const existing = pendingOpsRef.current.get(itemId);
    if (existing) return existing;
    const fresh: PendingOp = {
      patch: {},
      deleted: false,
      added: null,
      inflight: 0,
      queued: 0,
    };
    pendingOpsRef.current.set(itemId, fresh);
    return fresh;
  }, []);

  /** Forget an op once nothing about it is outstanding — the server now agrees. */
  const settleOp = useCallback((itemId: string) => {
    const op = pendingOpsRef.current.get(itemId);
    if (op && op.inflight <= 0 && op.queued <= 0) {
      pendingOpsRef.current.delete(itemId);
    }
  }, []);

  /**
   * Server truth with this device's unconfirmed changes laid back on top.
   *
   * Never hand a raw server snapshot to `setItems` — go through here, or local
   * work is lost the moment the app resumes.
   */
  const overlay = useCallback((serverItems: ShoppingItem[]): ShoppingItem[] => {
    const ops = pendingOpsRef.current;
    if (ops.size === 0) return serverItems;

    const merged: ShoppingItem[] = [];
    const seen = new Set<string>();

    for (const item of serverItems) {
      seen.add(item.id);
      const op = ops.get(item.id);
      if (!op) {
        merged.push(item);
        continue;
      }
      if (op.deleted) continue;
      merged.push({ ...item, ...op.patch });
    }

    // Items added on this device that the snapshot predates.
    for (const [id, op] of ops) {
      if (op.added && !op.deleted && !seen.has(id)) {
        merged.push({ ...op.added, ...op.patch });
      }
    }

    return merged.sort((a, b) => a.position - b.position);
  }, []);

  /** Apply a server snapshot to both React state and the offline cache. */
  const applySnapshot = useCallback(
    async (serverItems: ShoppingItem[], snapshotListId: string) => {
      const next = overlay(serverItems);
      await shoppingDB.items.where("listId").equals(snapshotListId).delete();
      await shoppingDB.items.bulkPut(next);
      setItems(next);
    },
    [overlay]
  );

  const flushPending = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setIsSyncing(true);

    try {
      const mutations = await shoppingDB.pendingMutations
        .orderBy("createdAt")
        .toArray();

      let drained = true;
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
            drained = false;
            break;
          }
        } catch {
          // Network failure — stop flushing
          drained = false;
          break;
        }
      }

      // The queue is empty, so everything that was parked has reached the
      // server and the next snapshot will contain it. Requests still in the air
      // are a different matter — those keep their override until they answer.
      if (drained) {
        for (const [id, op] of pendingOpsRef.current) {
          if (op.queued <= 0) continue;
          op.queued = 0;
          settleOp(id);
        }
      }

      // Re-sync canonical state from server after flushing
      const res = await fetch("/api/shopping/active", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.listId) {
          await applySnapshot(data.items as ShoppingItem[], data.listId);
        }
      }
    } finally {
      flushingRef.current = false;
      setIsSyncing(false);
      const count = await shoppingDB.pendingMutations.count();
      setPendingCount(count);
    }
  }, [applySnapshot, settleOp]);

  useEffect(() => {
    if (!listId) return;

    async function hydrate() {
      // Remove items from old lists so IDB doesn't grow unboundedly
      await shoppingDB.items.filter((i) => i.listId !== listId).delete();

      const count = await shoppingDB.pendingMutations.count();
      setPendingCount(count);

      if (count > 0) {
        // Work is still parked in the queue, so the server payload this page
        // rendered from predates it. The overrides that would have protected
        // it live in memory and did not survive the reload, so trust the
        // offline cache instead and let the flush reconcile the two.
        const cached = await shoppingDB.items
          .where("listId")
          .equals(listId!)
          .sortBy("position");
        if (cached.length > 0) setItems(cached);
        if (navigator.onLine) flushPending();
        return;
      }

      if (initialItems.length > 0) {
        await applySnapshot(initialItems, listId!);
      } else {
        const cached = await shoppingDB.items
          .where("listId")
          .equals(listId!)
          .sortBy("position");
        if (cached.length > 0) setItems(cached);
      }
    }

    hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  useEffect(() => {
    window.addEventListener("online", flushPending);
    return () => window.removeEventListener("online", flushPending);
  }, [flushPending]);

  // Refresh on resume: when the app returns to the foreground while online,
  // flush any queued changes and pull the latest list from the server. This is
  // the practical stand-in for background refresh, which iOS doesn't grant PWAs.
  useEffect(() => {
    function onResume() {
      if (document.visibilityState === "visible" && navigator.onLine) {
        flushPending();
      }
    }
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
    };
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

  /**
   * Send a mutation, parking it in the offline queue if it doesn't get through.
   * The caller has already recorded the local override; this only settles it.
   */
  const send = useCallback(
    async (
      itemId: string,
      op: PendingOp,
      req: { url: string; method: string; body: string }
    ) => {
      op.inflight++;
      try {
        const res = await fetch(req.url, {
          method: req.method,
          headers: { "Content-Type": "application/json" },
          ...(req.body ? { body: req.body } : {}),
        });
        if (!res.ok) throw new Error(`${req.method} ${req.url} failed`);
        op.inflight--;
        settleOp(itemId);
      } catch {
        op.inflight--;
        op.queued++;
        await shoppingDB.pendingMutations.add({
          url: req.url,
          method: req.method,
          body: req.body,
          createdAt: Date.now(),
        });
        const count = await shoppingDB.pendingMutations.count();
        setPendingCount(count);
        registerSync();
      }
    },
    [settleOp]
  );

  const toggle = useCallback(
    async (itemId: string, checked: boolean) => {
      const op = getOp(itemId);
      op.patch.isChecked = checked;

      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, isChecked: checked } : i))
      );
      await shoppingDB.items.update(itemId, { isChecked: checked });

      await send(itemId, op, {
        url: `/api/shopping/items/${itemId}/toggle`,
        method: "POST",
        body: JSON.stringify({ checked }),
      });
    },
    [getOp, send]
  );

  const update = useCallback(
    async (
      itemId: string,
      data: {
        ingredientName?: string;
        amount?: string | null;
        unit?: string | null;
        notes?: string | null;
      }
    ) => {
      const trimmedName =
        data.ingredientName !== undefined ? data.ingredientName.trim() : undefined;
      const patch = { ...data, ...(trimmedName !== undefined ? { ingredientName: trimmedName } : {}) };

      const op = getOp(itemId);
      Object.assign(op.patch, patch);

      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i))
      );
      await shoppingDB.items.update(itemId, patch);

      await send(itemId, op, {
        url: `/api/shopping/items/${itemId}`,
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    [getOp, send]
  );

  const remove = useCallback(
    async (itemId: string) => {
      const op = getOp(itemId);
      op.deleted = true;

      setItems((prev) => prev.filter((i) => i.id !== itemId));
      await shoppingDB.items.delete(itemId);

      await send(itemId, op, {
        url: `/api/shopping/items/${itemId}`,
        method: "DELETE",
        body: "",
      });
    },
    [getOp, send]
  );

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

      const op = getOp(id);
      op.added = newItem;

      setItems((prev) => [...prev, newItem]);
      await shoppingDB.items.put(newItem);

      await send(id, op, {
        url: "/api/shopping/items",
        method: "POST",
        body: JSON.stringify({ id, listId, ...data, position: maxPos + 1 }),
      });
    },
    [listId, items, getOp, send]
  );

  const clearCheckedLocal = useCallback(() => {
    setItems((prev) => {
      // Mark them deleted locally too, so a resume snapshot taken before the
      // server action commits doesn't bring them straight back.
      for (const item of prev) {
        if (item.isChecked) getOp(item.id).deleted = true;
      }
      return prev.filter((i) => !i.isChecked);
    });
    if (listId) {
      shoppingDB.items
        .where("listId")
        .equals(listId)
        .filter((i) => i.isChecked)
        .delete();
    }
  }, [listId, getOp]);

  return {
    items,
    toggle,
    update,
    remove,
    add,
    clearCheckedLocal,
    pendingCount,
    isSyncing,
  };
}
