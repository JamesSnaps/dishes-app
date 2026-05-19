"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@dishes/ui";

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
}

export function AddItemForm({ onAdd }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [category, setCategory] = useState<string>("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    const ingredientName = (data.get("ingredientName") as string)?.trim();
    if (!ingredientName) return;

    await onAdd({
      ingredientName,
      amount: (data.get("amount") as string)?.trim() || null,
      unit: (data.get("unit") as string)?.trim() || null,
      category: category || null,
      notes: null,
    });

    formRef.current?.reset();
    setCategory("");
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3"
    >
      <div className="flex gap-2">
        <Input
          name="ingredientName"
          placeholder="Add item…"
          required
          className="flex-1"
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
    </form>
  );
}
