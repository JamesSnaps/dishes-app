"use client";

import { useState, useRef, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import { ShoppingItem } from "./shopping-item";

type Item = {
  id: string;
  ingredientName: string;
  amount: string | null;
  unit: string | null;
  notes: string | null;
  isChecked: boolean;
  category: string | null;
  recipeId: string | null;
  recipeTitle: string | null;
};

interface Props {
  groups: Array<{ category: string | null; items: Item[] }>;
}

const HIDE_DELAY_MS = 1500;

export function ShoppingListView({ groups }: Props) {
  const [hideChecked, setHideChecked] = useState(true);
  const [recentlyChecked, setRecentlyChecked] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const t = timers.current;
    return () => { for (const id of t.values()) clearTimeout(id); };
  }, []);

  function handleItemChecked(itemId: string) {
    const existing = timers.current.get(itemId);
    if (existing) clearTimeout(existing);

    setRecentlyChecked((prev) => new Set([...prev, itemId]));

    const timer = setTimeout(() => {
      setRecentlyChecked((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      timers.current.delete(itemId);
    }, HIDE_DELAY_MS);

    timers.current.set(itemId, timer);
  }

  const totalChecked = groups.reduce(
    (acc, g) => acc + g.items.filter((i) => i.isChecked).length,
    0
  );

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: hideChecked
        ? g.items.filter((i) => !i.isChecked || recentlyChecked.has(i.id))
        : g.items,
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {totalChecked > 0 && (
        <button
          onClick={() => setHideChecked((v) => !v)}
          className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {hideChecked ? (
            <Eye className="h-4 w-4" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
          {hideChecked
            ? `Show ${totalChecked} checked`
            : `Hide ${totalChecked} checked`}
        </button>
      )}

      {visibleGroups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          All items checked — nothing left to get!
        </p>
      ) : (
        visibleGroups.map(({ category, items }) => (
          <section key={category ?? "__none__"}>
            {category && (
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </h2>
            )}
            <ul className="divide-y rounded-lg border bg-card">
              {items.map((item) => (
                <ShoppingItem
                  key={item.id}
                  item={item}
                  onChecked={() => handleItemChecked(item.id)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
