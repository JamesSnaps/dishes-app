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
  defaultOpen?: boolean;
}

export function OrderHistory({ items, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [pending, startTransition] = useTransition();

  if (items.length === 0) return null;

  function handleAdd(ingredientName: string) {
    const formData = new FormData();
    formData.set("ingredientName", ingredientName);
    startTransition(() => addItem(formData));
  }

  return (
    <section>
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
        <div className="mt-3 flex flex-col gap-1.5">
          {items.map((item) => (
            <button
              key={item.ingredientName}
              onClick={() => handleAdd(item.ingredientName)}
              disabled={pending}
              className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-left hover:bg-muted transition-colors disabled:opacity-50 w-full"
            >
              <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 min-w-0 truncate">{item.ingredientName}</span>
              {item.timesOrdered > 1 && (
                <span className="text-xs text-muted-foreground shrink-0">×{item.timesOrdered}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
