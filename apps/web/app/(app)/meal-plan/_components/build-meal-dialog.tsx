"use client";

import { useEffect, useState } from "react";
import { Check, UtensilsCrossed } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@dishes/ui";
import type { SavedMeal } from "@/lib/services/meals";
import { defaultSelection, slotName } from "@/lib/saved-meals";

interface Props {
  meal: SavedMeal | null;
  dayLabel: string;
  onOpenChange: (open: boolean) => void;
  /** Chosen recipe ids per slot id. */
  onConfirm: (selection: Record<string, string[]>) => void;
}

/**
 * Choose which version of a saved meal goes on the plan: one of the meats, any
 * of the veg. Opens with last time's choices ticked, so the usual is one tap.
 */
export function BuildMealDialog({ meal, dayLabel, onOpenChange, onConfirm }: Props) {
  const [selection, setSelection] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (meal) setSelection(defaultSelection(meal));
  }, [meal]);

  if (!meal) return null;

  const count = Object.values(selection).reduce((n, ids) => n + ids.length, 0);

  function choose(slotId: string, recipeId: string, multiple: boolean) {
    setSelection((prev) => {
      const current = prev[slotId] ?? [];
      if (!multiple) return { ...prev, [slotId]: [recipeId] };
      return {
        ...prev,
        [slotId]: current.includes(recipeId)
          ? current.filter((id) => id !== recipeId)
          : [...current, recipeId],
      };
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="h-8 w-8 shrink-0 rounded-lg bg-gradient-to-br from-orange-500 to-rose-500 text-white flex items-center justify-center shadow-sm">
              <UtensilsCrossed className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block line-clamp-1">{meal.title}</span>
              <span className="block text-xs font-normal text-muted-foreground">{dayLabel}</span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto -mx-2 px-2 py-1">
          {meal.slots.map((slot) => {
            const chosen = selection[slot.id] ?? [];
            return (
              <div key={slot.id}>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                  {slotName(slot)}
                  {slot.options.length > 1 && (
                    <span className="font-normal">
                      {" "}
                      · {slot.allowMultiple ? "pick any" : "pick one"}
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {slot.options.map((o) => {
                    const on = chosen.includes(o.recipe.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => choose(slot.id, o.recipe.id, slot.allowMultiple)}
                        aria-pressed={on}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-all ${
                          on
                            ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm"
                            : "border bg-white dark:bg-black/30 text-muted-foreground hover:text-foreground hover:border-orange-300"
                        }`}
                      >
                        {on && <Check className="h-3.5 w-3.5" />}
                        {o.recipe.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            onClick={() => onConfirm(selection)}
            disabled={count === 0}
            className="bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white border-0 shadow-md"
          >
            Add to plan ({count} dish{count === 1 ? "" : "es"})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
