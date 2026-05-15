"use client";

import { useTransition, useRef } from "react";
import { Trash2, Plus } from "lucide-react";
import { Button, Input } from "@dishes/ui";
import { addStockItem, removeStockItem } from "@/app/actions/pantry";

interface StockItem {
  id: string;
  ingredientName: string;
  amount: string | null;
  unit: string | null;
  addedAt: Date;
}

interface Props {
  items: StockItem[];
}

function formatAmount(amount: string | null): string {
  if (!amount) return "";
  const n = parseFloat(amount);
  if (isNaN(n)) return amount;
  return n % 1 === 0 ? String(n) : parseFloat(n.toFixed(2)).toString();
}

export function StockSection({ items }: Props) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleAdd(formData: FormData) {
    startTransition(async () => {
      await addStockItem(formData);
      formRef.current?.reset();
    });
  }

  function handleRemove(id: string) {
    startTransition(() => removeStockItem(id));
  }

  return (
    <section>
      <div className="mb-3">
        <h2 className="text-base font-semibold">Current Stock</h2>
        <p className="text-sm text-muted-foreground">
          Items you have on hand — used to skip duplicates when building shopping lists.
        </p>
      </div>

      {items.length > 0 ? (
        <ul className="mb-4 divide-y rounded-lg border bg-card">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm">{item.ingredientName}</span>
                {(item.amount || item.unit) && (
                  <span className="ml-2 text-sm text-muted-foreground">
                    {formatAmount(item.amount)}
                    {item.unit ? ` ${item.unit}` : ""}
                  </span>
                )}
              </div>
              <button
                onClick={() => handleRemove(item.id)}
                disabled={pending}
                className="shrink-0 text-muted-foreground/50 hover:text-destructive transition-colors"
                aria-label={`Remove ${item.ingredientName}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground italic">
          No stock items yet. They&apos;ll appear here when you add them or finish cooking a recipe.
        </p>
      )}

      <form ref={formRef} action={handleAdd} className="flex flex-wrap gap-2">
        <Input
          name="ingredientName"
          placeholder="Ingredient"
          className="w-40 flex-1 min-w-32"
          disabled={pending}
          required
        />
        <Input
          name="amount"
          placeholder="Amount"
          className="w-24"
          disabled={pending}
          type="number"
          min="0"
          step="any"
        />
        <Input
          name="unit"
          placeholder="Unit"
          className="w-20"
          disabled={pending}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </form>
    </section>
  );
}
