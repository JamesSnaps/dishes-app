"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { ShoppingItem } from "./shopping-item";
import type { ShoppingItem as ShoppingItemType } from "@/hooks/use-shopping-list";

interface Group {
  category: string | null;
  items: ShoppingItemType[];
}

interface Props {
  groups: Group[];
  onToggle: (id: string, checked: boolean) => void;
  onUpdate: (
    id: string,
    data: { ingredientName?: string; amount?: string | null; unit?: string | null; notes?: string | null }
  ) => void;
  onDelete: (id: string) => void;
}

export function ShoppingListView({ groups, onToggle, onUpdate, onDelete }: Props) {
  const [hideChecked, setHideChecked] = useState(true);

  const totalChecked = groups.reduce(
    (acc, g) => acc + g.items.filter((i) => i.isChecked).length,
    0
  );

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: hideChecked ? g.items.filter((i) => !i.isChecked) : g.items,
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
                  onToggle={(checked) => onToggle(item.id, checked)}
                  onUpdate={(data) => onUpdate(item.id, data)}
                  onDelete={() => onDelete(item.id)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
