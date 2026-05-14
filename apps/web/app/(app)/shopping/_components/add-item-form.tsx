"use client";

import { useRef, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@dishes/ui";
import { addItem } from "@/app/actions/shopping";

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

export function AddItemForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await addItem(formData);
      formRef.current?.reset();
    });
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3"
    >
      <div className="flex gap-2">
        <Input
          name="ingredientName"
          placeholder="Add item…"
          required
          className="flex-1"
          disabled={pending}
        />
        <Button type="submit" size="sm" disabled={pending} className="shrink-0">
          <Plus className="h-4 w-4" />
          <span className="sr-only">Add</span>
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          name="amount"
          placeholder="Qty"
          className="w-20"
          disabled={pending}
          type="number"
          min="0"
          step="any"
        />
        <Input
          name="unit"
          placeholder="Unit"
          className="w-24"
          disabled={pending}
        />
        <Select name="category" disabled={pending}>
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
