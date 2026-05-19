"use client";

import { useMemo } from "react";
import { WifiOff, RefreshCw } from "lucide-react";
import { useShoppingList, type ShoppingItem } from "@/hooks/use-shopping-list";
import { ShoppingListView } from "./shopping-list-view";
import { AddItemForm } from "./add-item-form";
import { ListActions } from "./list-actions";
import { OrderHistory } from "./order-history";

const CATEGORY_ORDER = [
  "Produce",
  "Dairy",
  "Meat",
  "Fish",
  "Bakery",
  "Pantry",
  "Frozen",
  "Drinks",
  "Cleaning",
  "Other",
  null,
];

interface Props {
  listId: string;
  initialItems: ShoppingItem[];
  mostOrdered: { ingredientName: string; timesOrdered: number }[];
}

export function ShoppingListClient({ listId, initialItems, mostOrdered }: Props) {
  const { items, toggle, remove, add, clearCheckedLocal, pendingCount, isSyncing } =
    useShoppingList(initialItems, listId);

  const groups = useMemo(() => {
    const grouped = new Map<string | null, ShoppingItem[]>();
    for (const item of items) {
      const key = item.category ?? null;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    }

    return [...grouped.entries()]
      .sort(([a], [b]) => {
        const ai = CATEGORY_ORDER.indexOf(a);
        const bi = CATEGORY_ORDER.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .map(([category, groupItems]) => ({ category, items: groupItems }));
  }, [items]);

  const hasChecked = items.some((i) => i.isChecked);

  return (
    <div className="flex flex-col gap-4">
      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          {isSyncing ? (
            <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
          ) : (
            <WifiOff className="h-4 w-4 shrink-0" />
          )}
          {isSyncing
            ? "Syncing changes…"
            : `${pendingCount} change${pendingCount !== 1 ? "s" : ""} waiting to sync`}
        </div>
      )}

      <AddItemForm onAdd={add} />

      {items.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground text-sm">
          Your list is empty — add an item or pull in a recipe above.
        </p>
      ) : (
        <ShoppingListView
          groups={groups}
          onToggle={toggle}
          onDelete={remove}
        />
      )}

      {items.length > 0 && (
        <ListActions
          listId={listId}
          hasChecked={hasChecked}
          onClearChecked={clearCheckedLocal}
        />
      )}

      {mostOrdered.length > 0 && (
        <div className="border-t pt-4">
          <OrderHistory
            items={mostOrdered}
            onAdd={(name) =>
              add({ ingredientName: name, amount: null, unit: null, category: null, notes: null })
            }
          />
        </div>
      )}
    </div>
  );
}
