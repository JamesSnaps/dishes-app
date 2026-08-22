"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Pencil, ShoppingCart, Trash2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@dishes/ui";
import { formatQuantity } from "@/lib/format-quantity";
import type { ShoppingItem as ShoppingItemType } from "@/hooks/use-shopping-list";

interface Props {
  item: ShoppingItemType;
  onToggle: (checked: boolean) => void;
  onUpdate: (data: {
    ingredientName?: string;
    amount?: string | null;
    unit?: string | null;
    notes?: string | null;
  }) => void;
  onDelete: () => void;
}

export function ShoppingItem({ item, onToggle, onUpdate, onDelete }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(item.ingredientName);
  const [amount, setAmount] = useState(item.amount ?? "");
  const [unit, setUnit] = useState(item.unit ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");

  function startEditing() {
    setName(item.ingredientName);
    setAmount(item.amount ?? "");
    setUnit(item.unit ?? "");
    setNotes(item.notes ?? "");
    setIsEditing(true);
  }

  function save() {
    if (!name.trim()) return;
    onUpdate({
      ingredientName: name,
      amount: amount.trim() || null,
      unit: unit.trim() || null,
      notes: notes.trim() || null,
    });
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <li className="flex flex-col gap-2 py-3 px-4 bg-muted/40">
        <div className="flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Qty"
            inputMode="decimal"
            className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            aria-label="Amount"
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Unit"
            className="w-20 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            aria-label="Unit"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setIsEditing(false);
            }}
            className="flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            aria-label="Item name"
          />
        </div>
        <div className="flex gap-2">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setIsEditing(false);
            }}
            className="flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            aria-label="Notes"
          />
          <button
            onClick={save}
            disabled={!name.trim()}
            className="flex-shrink-0 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            Save
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="flex-shrink-0 inline-flex items-center rounded-md border border-input px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </li>
    );
  }

  const { amount: displayAmount, unit: displayUnit } = formatQuantity(item.amount, item.unit);
  const label = [displayAmount, displayUnit, item.ingredientName]
    .filter(Boolean)
    .join(" ");

  return (
    <li className="flex items-center gap-3 py-3 px-4">
      <input
        type="checkbox"
        checked={item.isChecked}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-5 w-5 flex-shrink-0 rounded border-gray-300 accent-primary cursor-pointer"
        aria-label={`Mark ${item.ingredientName} as ${item.isChecked ? "unchecked" : "checked"}`}
      />
      <span
        className={`flex-1 min-w-0 text-base leading-snug ${
          item.isChecked ? "line-through text-muted-foreground" : ""
        }`}
      >
        {label}
        {item.notes && (
          <span className="ml-1 text-sm text-muted-foreground">
            ({item.notes})
          </span>
        )}
        {(() => {
          // Prefer the id-carrying sources; fall back to bare titles for items
          // still held in an older offline cache.
          const sources =
            item.recipeSources && item.recipeSources.length > 0
              ? item.recipeSources
              : (item.recipeTitles && item.recipeTitles.length > 0
                  ? item.recipeTitles
                  : item.recipeTitle
                    ? [item.recipeTitle]
                    : []
                ).map((title) => ({ id: null as string | null, title }));
          if (sources.length === 0) return null;

          const first = sources[0]!;
          const rest = sources.slice(1);
          // Full source list on hover — the badge below covers touch devices,
          // where a title attribute never appears.
          const fullList = sources.map((s) => s.title).join(", ");
          const firstId = first.id ?? item.recipeId;

          return (
            <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs leading-tight">
              {firstId ? (
                <Link
                  href={`/recipes/${firstId}`}
                  title={fullList}
                  className="text-muted-foreground/60 hover:text-primary hover:underline"
                >
                  from {first.title}
                </Link>
              ) : (
                <span title={fullList} className="text-muted-foreground/60">
                  from {first.title}
                </span>
              )}
              {rest.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      title={fullList}
                      aria-label={`Show all ${sources.length} recipes using ${item.ingredientName}`}
                      className="rounded-full bg-muted px-1.5 py-px font-medium text-muted-foreground transition-colors hover:bg-muted-foreground/20 hover:text-foreground"
                    >
                      +{rest.length} more
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-w-[16rem]">
                    <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                      Also needed for
                    </DropdownMenuLabel>
                    {rest.map((source, i) => (
                      <DropdownMenuItem
                        key={source.id ?? `${source.title}-${i}`}
                        asChild={!!source.id}
                        className="text-xs whitespace-normal"
                        {...(source.id ? {} : { onSelect: (e: Event) => e.preventDefault() })}
                      >
                        {source.id ? (
                          <Link href={`/recipes/${source.id}`}>{source.title}</Link>
                        ) : (
                          <span>{source.title}</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </span>
          );
        })()}
      </span>
      <button
        onClick={startEditing}
        className="flex-shrink-0 p-1 text-muted-foreground hover:text-primary transition-colors"
        aria-label={`Edit ${item.ingredientName}`}
      >
        <Pencil className="h-4 w-4" />
      </button>
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
        onClick={onDelete}
        className="flex-shrink-0 p-1 text-muted-foreground hover:text-destructive transition-colors"
        aria-label={`Remove ${item.ingredientName}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
