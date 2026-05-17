"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { addItem } from "@/app/actions/shopping";

interface HistoryItem {
  ingredientName: string;
  timesOrdered: number;
}

interface Props {
  items: HistoryItem[];
}

export function OrderHistory({ items }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (items.length === 0) return null;

  function handleAdd(ingredientName: string) {
    const formData = new FormData();
    formData.set("ingredientName", ingredientName);
    startTransition(() => addItem(formData));
  }

  return (
    <section className="mt-2 border-t pt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        Frequently bought
        <span className="text-xs font-normal">({items.length})</span>
      </button>

      {open && (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={item.ingredientName}
              onClick={() => handleAdd(item.ingredientName)}
              disabled={pending}
              className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1.5 text-sm hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Plus className="h-3 w-3 text-muted-foreground" />
              {item.ingredientName}
              {item.timesOrdered > 1 && (
                <span className="text-xs text-muted-foreground">×{item.timesOrdered}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
