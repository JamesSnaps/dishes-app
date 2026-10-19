"use client";

import { useEffect, useMemo, useState } from "react";
import type { SyncRecord } from "@dishes/client";
import { useSync } from "@/components/providers/sync-provider";
import {
  buildSuggestionIndex,
  suggestionKey,
  type SuggestionIndex,
} from "@/lib/shopping-suggestions";
import type { ShoppingItem } from "@/hooks/use-shopping-list";

type Local = { history: SyncRecord[]; recipes: SyncRecord[] };

/**
 * The suggestion index for the add field, from the local sync store.
 *
 * Nothing is read until `active` (the field has been focused once), so a visit
 * to the list that adds nothing costs nothing; after that it re-reads when the
 * store changes. `items` is the list on screen, which is ahead of the store by
 * anything added since the last pull. `mostOrdered` (from the server render)
 * only stands in while the store is still empty — a first visit before the
 * first sync has finished.
 */
export function useShoppingSuggestions(
  active: boolean,
  items: ShoppingItem[],
  mostOrdered: { ingredientName: string; timesOrdered: number }[]
): { index: SuggestionIndex; exclude: Set<string> } {
  const sync = useSync();
  const engine = sync?.engine ?? null;
  const version = sync?.version ?? 0;
  const [local, setLocal] = useState<Local | null>(null);

  useEffect(() => {
    if (!active || !engine) return;
    let cancelled = false;
    Promise.all([engine.read("shoppingItems"), engine.read("recipes")])
      .then(([history, recipes]) => {
        if (!cancelled) setLocal({ history, recipes });
      })
      .catch(() => {
        // An unreadable store means no suggestions, never a broken add field.
      });
    return () => {
      cancelled = true;
    };
  }, [active, engine, version]);

  const index = useMemo(() => {
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of local?.history ?? []) byId.set(row.id, row);
    for (const item of items) byId.set(item.id, { ...byId.get(item.id), ...item });

    const history: Record<string, unknown>[] = [...byId.values()];
    if (!local?.history.length) {
      for (const { ingredientName, timesOrdered } of mostOrdered) {
        for (let i = 0; i < timesOrdered; i++) history.push({ ingredientName });
      }
    }
    return buildSuggestionIndex(history, local?.recipes ?? []);
  }, [local, items, mostOrdered]);

  const exclude = useMemo(
    () => new Set(items.filter((i) => !i.isChecked).map((i) => suggestionKey(i.ingredientName))),
    [items]
  );

  return { index, exclude };
}
