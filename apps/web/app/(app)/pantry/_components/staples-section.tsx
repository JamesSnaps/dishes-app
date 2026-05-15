"use client";

import { useTransition, useRef } from "react";
import { X, Plus } from "lucide-react";
import { Button, Input } from "@dishes/ui";
import { addStaple, removeStaple } from "@/app/actions/pantry";

interface Staple {
  id: string;
  ingredientName: string;
}

interface Props {
  staples: Staple[];
}

export function StaplesSection({ staples }: Props) {
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleAdd(formData: FormData) {
    const name = (formData.get("ingredientName") as string)?.trim();
    if (!name) return;
    startTransition(async () => {
      await addStaple(name);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function handleRemove(id: string) {
    startTransition(() => removeStaple(id));
  }

  return (
    <section>
      <div className="mb-3">
        <h2 className="text-base font-semibold">Staples</h2>
        <p className="text-sm text-muted-foreground">
          Things you always have — excluded from shopping lists automatically.
        </p>
      </div>

      {staples.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2">
          {staples.map((staple) => (
            <li
              key={staple.id}
              className="flex items-center gap-1.5 rounded-full border bg-muted/40 pl-3 pr-1.5 py-1 text-sm"
            >
              {staple.ingredientName}
              <button
                onClick={() => handleRemove(staple.id)}
                disabled={pending}
                className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label={`Remove ${staple.ingredientName}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {staples.length === 0 && (
        <p className="mb-3 text-sm text-muted-foreground italic">
          No staples yet — add things like olive oil, salt, or garlic.
        </p>
      )}

      <form action={handleAdd} className="flex gap-2">
        <Input
          ref={inputRef}
          name="ingredientName"
          placeholder="e.g. Olive oil"
          className="max-w-xs"
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
