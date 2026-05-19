"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

interface HistoryItem {
  ingredientName: string;
  timesOrdered: number;
}

interface Props {
  items: HistoryItem[];
  defaultOpen?: boolean;
  onAdd?: (ingredientName: string) => void;
}

export function OrderHistory({ items, defaultOpen = false, onAdd }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  if (items.length === 0) return null;

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
              onClick={() => onAdd?.(item.ingredientName)}
              disabled={!onAdd}
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
