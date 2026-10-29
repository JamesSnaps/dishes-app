"use client";

import { ComponentSuggestions } from "@/components/meals/component-suggestions";
import { useEffect, useState } from "react";
import { Check, UtensilsCrossed } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@dishes/ui";
import { MEAL_ROLES, MEAL_ROLE_LABELS, type MealRole } from "@dishes/shared";
import type { PlanWriter } from "./plan-writer";
import type { Entry } from "./week-planner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The entry the user started from; always included, as the main. */
  anchor: Entry;
  /** Other separate dishes on the same day that could join it. */
  candidates: Entry[];
  weekStartDate: string;
  writer: PlanWriter;
}

/**
 * Turn dishes already on the plan into one combined meal — the path for "I put
 * the chicken, potatoes and cabbage on Sunday separately; they're one dinner".
 * Dishes in the anchor's slot start ticked; others on the day are offered too
 * and move into the anchor's slot when chosen.
 */
export function CombineMealDialog({
  open,
  onOpenChange,
  anchor,
  candidates,
  weekStartDate,
  writer,
}: Props) {
  const [extras, setExtras] = useState<Array<{ recipeId: string; title: string; role: MealRole }>>([]);
  const [title, setTitle] = useState("");
  const [roles, setRoles] = useState<Record<string, MealRole>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Re-seed whenever it opens, so a previous attempt doesn't linger.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setExtras([]);
    setRoles({ [anchor.id]: "main" });
    setSelected(
      new Set([
        anchor.id,
        ...candidates.filter((c) => c.mealType === anchor.mealType).map((c) => c.id),
      ])
    );
  }, [open, anchor.id, anchor.mealType, candidates]);

  const dishes = [anchor, ...candidates];
  const roleOf = (id: string): MealRole => roles[id] ?? "side";

  function toggle(id: string) {
    if (id === anchor.id) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    const name = title.trim();
    if (!name) return;
    writer.addGroup({
      weekStartDate,
      title: name,
      dayOfWeek: anchor.dayOfWeek,
      mealType: anchor.mealType,
      components: extras.map(({ recipeId, role }) => ({ recipeId, role })),
      entries: dishes
        .filter((d) => selected.has(d.id))
        .map((d) => ({ entryId: d.id, role: roleOf(d.id) })),
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
              <UtensilsCrossed className="h-4 w-4" />
            </span>
            Make into a meal
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto -mx-2 px-2 py-1">
          <div>
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="combine-title">
              Meal name
            </label>
            <Input
              id="combine-title"
              placeholder="e.g. Sunday roast"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              maxLength={200}
              autoFocus
              className="mt-1"
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Dishes</p>
            {candidates.length === 0 && (
              <p className="text-xs text-muted-foreground mb-2">
                Nothing else is planned for this day yet — you can add dishes to the meal once
                it&apos;s made.
              </p>
            )}
            <ul className="space-y-2">
              {dishes.map((d) => {
                const on = selected.has(d.id);
                return (
                  <li
                    key={d.id}
                    className={`rounded-xl border p-2.5 transition-colors ${
                      on
                        ? "border-transparent bg-highlight shadow-sm"
                        : "bg-muted/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(d.id)}
                      disabled={d.id === anchor.id}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <span
                        className={`h-5 w-5 shrink-0 rounded-md border-2 flex items-center justify-center ${
                          on ? "border-transparent bg-primary text-primary-foreground" : "border-muted-foreground/40"
                        }`}
                      >
                        {on && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="text-sm font-semibold line-clamp-1">{d.recipe.title}</span>
                    </button>
                    {on && (
                      <div className="mt-2 flex flex-wrap gap-1 pl-7">
                        {MEAL_ROLES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setRoles((prev) => ({ ...prev, [d.id]: r }))}
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all ${
                              roleOf(d.id) === r
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "bg-card dark:bg-black/30 border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {MEAL_ROLE_LABELS[r]}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          {extras.map((s) => <div key={s.recipeId} className="flex items-center gap-2 text-sm"><span className="flex-1">{s.title} · {MEAL_ROLE_LABELS[s.role]}</span><Button type="button" variant="ghost" size="sm" onClick={() => setExtras((prev) => prev.filter((e) => e.recipeId !== s.recipeId))}>Remove</Button></div>)}
          <ComponentSuggestions mealTitle={title} recipeIds={[...dishes.filter((d) => selected.has(d.id)).map((d) => d.recipe.id), ...extras.map((e) => e.recipeId)]}
            onAdd={(suggestion) => {
              const existing = dishes.find((d) => d.recipe.id === suggestion.recipeId);
              if (existing) {
                setSelected((prev) => new Set([...prev, existing.id]));
                setRoles((prev) => ({ ...prev, [existing.id]: suggestion.role }));
              } else {
                setExtras((prev) => prev.some((e) => e.recipeId === suggestion.recipeId) ? prev : [...prev, suggestion]);
              }
            }} />
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!title.trim()}
            className="bg-primary text-primary-foreground border-0 shadow-md"
          >
            Make meal ({selected.size + extras.length} dish{selected.size + extras.length === 1 ? "" : "es"})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
