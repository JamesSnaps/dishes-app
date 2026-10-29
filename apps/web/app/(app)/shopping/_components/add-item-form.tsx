"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ChefHat, History, Plus } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@dishes/ui";
import type { ShoppingItem } from "@/hooks/use-shopping-list";
import { useShoppingSuggestions } from "@/hooks/use-shopping-suggestions";
import { suggestShoppingItems, type ShoppingSuggestion } from "@/lib/shopping-suggestions";

const CATEGORIES = [
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
];

interface Props {
  onAdd: (data: {
    ingredientName: string;
    amount: string | null;
    unit: string | null;
    category: string | null;
    notes: string | null;
  }) => Promise<void>;
  /** The list on screen — its unticked items aren't suggested again. */
  items: ShoppingItem[];
  mostOrdered: { ingredientName: string; timesOrdered: number }[];
}

export function AddItemForm({ onAdd, items, mostOrdered }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("");
  const [focusedOnce, setFocusedOnce] = useState(false);
  const [open, setOpen] = useState(false);
  /** Highlighted suggestion; -1 is none, so Enter still adds what was typed. */
  const [active, setActive] = useState(-1);

  const { index, exclude } = useShoppingSuggestions(focusedOnce, items, mostOrdered);
  const suggestions = useMemo(
    () => (open ? suggestShoppingItems(index, name, exclude) : []),
    [open, index, name, exclude]
  );
  const showing = suggestions.length > 0;

  /**
   * The one way an item gets added, typed or picked. The field clears before
   * the add is awaited, so the next item can be typed straight away.
   */
  function addItem(ingredientName: string, rememberedCategory: string | null) {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const entry = {
      ingredientName,
      amount: (data.get("amount") as string)?.trim() || null,
      unit: (data.get("unit") as string)?.trim() || null,
      // A category chosen here wins; otherwise a picked item goes back in its aisle.
      category: category || rememberedCategory || null,
      notes: null,
    };

    form.reset();
    setName("");
    setCategory("");
    setOpen(false);
    setActive(-1);
    inputRef.current?.focus();

    void onAdd(entry);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const typed = name.trim();
    if (!typed) return;
    addItem(typed, null);
  }

  function pick(s: ShoppingSuggestion) {
    addItem(s.name, s.category);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!showing) {
        if (name.trim()) setOpen(true);
        return;
      }
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Wraps through "nothing highlighted", back to the text as typed.
      setActive((i) => {
        const next = i + step;
        if (next < -1) return suggestions.length - 1;
        if (next >= suggestions.length) return -1;
        return next;
      });
    } else if (e.key === "Enter" && showing && active >= 0) {
      e.preventDefault();
      const s = suggestions[active];
      if (s) pick(s);
    } else if (e.key === "Escape" && showing) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3"
    >
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          name="ingredientName"
          placeholder="Add item…"
          required
          className="flex-1"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showing}
          aria-controls={listboxId}
          aria-activedescendant={showing && active >= 0 ? `${listboxId}-${active}` : undefined}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => {
            setFocusedOnce(true);
            if (name.trim()) setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        <Button type="submit" size="sm" className="shrink-0">
          <Plus className="h-4 w-4" />
          <span className="sr-only">Add</span>
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          name="amount"
          placeholder="Qty"
          className="w-20"
          type="number"
          min="0"
          step="any"
        />
        <Input name="unit" placeholder="Unit" className="w-24" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showing && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Suggestions"
          // Below the card's controls rather than over them, so Qty and the
          // category stay reachable straight after typing. Mouse-down is held
          // back so a tap doesn't blur the field (closing the list before the
          // click lands) and the keyboard stays up for the next item.
          onMouseDown={(e) => e.preventDefault()}
          className="flex flex-col gap-1 rounded-xl border border-transparent bg-highlight p-1.5 shadow-lg dark:shadow-black/40"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.source}:${s.name}`}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                i === active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-card/80 text-foreground shadow-sm"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  i === active
                    ? "bg-background/20 text-background"
                    : s.source === "history"
                      ? "bg-highlight text-primary"
                      : "bg-highlight text-primary"
                }`}
                aria-hidden
              >
                {s.source === "history" ? (
                  <History className="h-3.5 w-3.5" />
                ) : (
                  <ChefHat className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <Highlighted text={s.name} query={name} />
              </span>
              <span
                className={`shrink-0 text-xs ${i === active ? "text-background/85" : "text-muted-foreground"}`}
              >
                {s.source === "history"
                  ? [s.category, s.count > 1 ? `×${s.count}` : null].filter(Boolean).join(" · ")
                  : s.count > 1
                    ? `${s.count} recipes`
                    : "in a recipe"}
              </span>
              <Plus
                className={`h-4 w-4 shrink-0 ${i === active ? "text-background" : "text-primary"}`}
                aria-hidden
              />
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** The name with the typed part in bold, where it appears as typed. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <strong className="font-semibold">{text.slice(at, at + q.length)}</strong>
      {text.slice(at + q.length)}
    </>
  );
}
