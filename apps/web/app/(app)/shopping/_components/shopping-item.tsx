"use client";

import { useTransition } from "react";
import { ShoppingCart, Trash2 } from "lucide-react";
import { toggleItem, deleteItem } from "@/app/actions/shopping";
import { formatQuantity } from "@/lib/format-quantity";

interface Props {
  item: {
    id: string;
    ingredientName: string;
    amount: string | null;
    unit: string | null;
    notes: string | null;
    isChecked: boolean;
    category: string | null;
  };
}

export function ShoppingItem({ item }: Props) {
  const [pending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    startTransition(() => toggleItem(item.id, checked));
  }

  function handleDelete() {
    startTransition(() => deleteItem(item.id));
  }

  const { amount: displayAmount, unit: displayUnit } = formatQuantity(item.amount, item.unit);
  const label = [displayAmount, displayUnit, item.ingredientName]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={`flex items-center gap-3 py-3 px-4 transition-opacity ${pending ? "opacity-50" : ""}`}
    >
      <input
        type="checkbox"
        checked={item.isChecked}
        onChange={(e) => handleToggle(e.target.checked)}
        className="h-5 w-5 flex-shrink-0 rounded border-gray-300 accent-primary cursor-pointer"
        aria-label={`Mark ${item.ingredientName} as ${item.isChecked ? "unchecked" : "checked"}`}
      />
      <span
        className={`flex-1 text-base leading-snug ${
          item.isChecked ? "line-through text-muted-foreground" : ""
        }`}
      >
        {label}
        {item.notes && (
          <span className="ml-1 text-sm text-muted-foreground">
            ({item.notes})
          </span>
        )}
      </span>
      {!item.isChecked && (
        <a
          href={`https://www.sainsburys.co.uk/gol-ui/SearchResults/${encodeURIComponent(item.ingredientName)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 p-1 text-muted-foreground hover:text-orange-500 transition-colors"
          aria-label={`Search for ${item.ingredientName} on Sainsbury's`}
        >
          <ShoppingCart className="h-4 w-4" />
        </a>
      )}
      <button
        onClick={handleDelete}
        disabled={pending}
        className="flex-shrink-0 p-1 text-muted-foreground hover:text-destructive transition-colors"
        aria-label={`Remove ${item.ingredientName}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
