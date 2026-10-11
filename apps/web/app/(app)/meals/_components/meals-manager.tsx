"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Clock,
  Pencil,
  Plus,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@dishes/ui";
import {
  MEAL_ROLES,
  MEAL_ROLE_LABELS,
  MEAL_TYPES,
  type MealRole,
  type MealType,
} from "@dishes/shared";
import { createSavedMeal, deleteSavedMeal, updateSavedMeal } from "@/app/actions/meals";
import type { SavedMeal } from "@/lib/services/meals";
import { useToast } from "@/hooks/use-toast";
import { AddEntryDialog } from "@/app/(app)/meal-plan/_components/add-entry-dialog";
import type { Recipe } from "@/app/(app)/meal-plan/_components/week-planner";

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
};

const ROLE_CHIP: Record<MealRole, string> = {
  main: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  side: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  sauce: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  other: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
};

function longestMinutes(meal: SavedMeal): number {
  return meal.components.reduce(
    (max, c) => Math.max(max, (c.recipe.prepTimeMinutes ?? 0) + (c.recipe.cookTimeMinutes ?? 0)),
    0
  );
}

function formatMinutes(total: number): string {
  return total < 60
    ? `${total}m`
    : `${Math.floor(total / 60)}h${total % 60 > 0 ? ` ${total % 60}m` : ""}`;
}

type Draft = {
  id: string | null;
  title: string;
  defaultMealType: MealType;
  components: { key: string; recipeId: string; role: MealRole }[];
};

function emptyDraft(): Draft {
  return { id: null, title: "", defaultMealType: "dinner", components: [] };
}

function draftFrom(meal: SavedMeal): Draft {
  return {
    id: meal.id,
    title: meal.title,
    defaultMealType: meal.defaultMealType,
    components: meal.components.map((c) => ({ key: c.id, recipeId: c.recipe.id, role: c.role })),
  };
}

export function MealsManager({
  savedMeals,
  recipes,
}: {
  savedMeals: SavedMeal[];
  recipes: Recipe[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pickRole, setPickRole] = useState<MealRole | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedMeal | null>(null);

  const recipeById = new Map(recipes.map((r) => [r.id, r]));

  function save() {
    if (!draft) return;
    const input = {
      title: draft.title,
      defaultMealType: draft.defaultMealType,
      components: draft.components.map(({ recipeId, role }) => ({ recipeId, role })),
    };
    startTransition(async () => {
      const res = draft.id
        ? await updateSavedMeal(draft.id, input)
        : await createSavedMeal(input);
      if (!res.ok) {
        toast({ title: "Couldn't save the meal", description: res.error, variant: "destructive" });
        return;
      }
      setDraft(null);
      router.refresh();
      toast({ title: draft.id ? "Meal updated" : "Meal saved", description: input.title });
    });
  }

  function remove(meal: SavedMeal) {
    startTransition(async () => {
      const res = await deleteSavedMeal(meal.id);
      setConfirmDelete(null);
      if (!res.ok) {
        toast({ title: "Couldn't delete the meal", description: res.error, variant: "destructive" });
        return;
      }
      router.refresh();
      toast({ title: "Meal deleted", description: `${meal.title} — planned copies keep their dishes.` });
    });
  }

  function addComponent(recipeId: string) {
    if (!draft || !pickRole) return;
    setDraft({
      ...draft,
      components: [...draft.components, { key: crypto.randomUUID(), recipeId, role: pickRole }],
    });
    setPickRole(null);
  }

  const sortedDraft = draft
    ? [...draft.components].sort((a, b) => MEAL_ROLES.indexOf(a.role) - MEAL_ROLES.indexOf(b.role))
    : [];

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Saved meals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Combinations of recipes you cook together — a roast and its sides, a curry night.
          </p>
        </div>
        <Button
          onClick={() => setDraft(emptyDraft())}
          className="shrink-0 bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white border-0 shadow-md"
        >
          <Plus className="mr-1 h-4 w-4" />
          New meal
        </Button>
      </div>

      {savedMeals.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 dark:from-orange-950/20 dark:via-amber-950/10 dark:to-rose-950/20 py-20 px-6 text-center gap-3 shadow-sm">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 text-white flex items-center justify-center shadow-md">
            <UtensilsCrossed className="h-7 w-7" />
          </div>
          <p className="font-semibold">No saved meals yet</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Build one here, or combine dishes on the{" "}
            <Link href="/meal-plan" className="font-medium text-foreground underline underline-offset-2">
              meal plan
            </Link>{" "}
            and choose “Save as a meal”.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {savedMeals.map((meal) => {
            const minutes = longestMinutes(meal);
            return (
              <div
                key={meal.id}
                className="flex flex-col rounded-2xl border border-orange-200/70 dark:border-orange-900/50 bg-gradient-to-br from-orange-50 via-amber-50/80 to-rose-50 dark:from-orange-950/30 dark:via-amber-950/15 dark:to-rose-950/25 p-4 shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-white flex items-center justify-center shadow-sm">
                    <UtensilsCrossed className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold leading-snug line-clamp-1">{meal.title}</p>
                    <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 whitespace-nowrap">
                      <span className="flex items-center gap-0.5">
                        <CalendarDays className="h-3 w-3" />
                        {MEAL_TYPE_LABEL[meal.defaultMealType]}
                      </span>
                      <span>
                        {meal.components.length} dish{meal.components.length === 1 ? "" : "es"}
                      </span>
                      {minutes > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />~{formatMinutes(minutes)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <ul className="mt-3 flex-1 rounded-xl bg-white/70 dark:bg-black/20 divide-y divide-orange-100 dark:divide-orange-950/60 shadow-sm">
                  {meal.components.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/recipes/${c.recipe.id}`}
                        className="flex items-center gap-2 px-2.5 py-2 hover:bg-white/80 dark:hover:bg-white/5 transition-colors"
                      >
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${ROLE_CHIP[c.role]}`}
                        >
                          {MEAL_ROLE_LABELS[c.role]}
                        </span>
                        <span className="text-sm font-medium truncate">{c.recipe.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => setDraft(draftFrom(meal))}
                    className="flex-1 bg-white/80 dark:bg-black/30 text-foreground border border-orange-300/70 dark:border-orange-800/60 hover:bg-white shadow-sm"
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmDelete(meal)}
                    className="text-destructive border-destructive/40 hover:bg-destructive/10"
                    aria-label={`Delete ${meal.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Editor ── */}
      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit meal" : "New meal"}</DialogTitle>
          </DialogHeader>

          {draft && (
            <div className="space-y-4 overflow-y-auto py-1">
              <div>
                <label htmlFor="meal-title" className="text-xs font-semibold text-muted-foreground">
                  Name
                </label>
                <Input
                  id="meal-title"
                  placeholder="e.g. Sunday roast"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  maxLength={200}
                  className="mt-1"
                  autoFocus
                />
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">Usually for</p>
                <div className="flex flex-wrap gap-1.5">
                  {MEAL_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDraft({ ...draft, defaultMealType: t })}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                        draft.defaultMealType === t
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {MEAL_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">Dishes</p>
                {sortedDraft.length === 0 && (
                  <p className="text-sm text-muted-foreground mb-2">Add the dishes that make up this meal.</p>
                )}
                <ul className="space-y-2">
                  {sortedDraft.map((c) => (
                    <li
                      key={c.key}
                      className="rounded-xl border border-orange-200/70 dark:border-orange-900/50 bg-gradient-to-br from-orange-50 to-rose-50 dark:from-orange-950/30 dark:to-rose-950/20 p-2.5 shadow-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold flex-1 line-clamp-1">
                          {recipeById.get(c.recipeId)?.title ?? "Recipe"}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              components: draft.components.filter((x) => x.key !== c.key),
                            })
                          }
                          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          aria-label="Remove dish"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {MEAL_ROLES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                components: draft.components.map((x) =>
                                  x.key === c.key ? { ...x, role: r } : x
                                ),
                              })
                            }
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all ${
                              c.role === r
                                ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm"
                                : "bg-white dark:bg-black/30 border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {MEAL_ROLE_LABELS[r]}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  {MEAL_ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setPickRole(r)}
                      className="flex items-center justify-center gap-1 rounded-xl border border-orange-300/70 dark:border-orange-800/60 bg-white/70 dark:bg-black/20 py-1.5 text-xs font-semibold text-orange-700 dark:text-orange-300 shadow-sm hover:bg-white dark:hover:bg-black/30 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add a {MEAL_ROLE_LABELS[r].toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={save}
              disabled={pending || !draft?.title.trim() || !draft?.components.length}
              className="bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white border-0 shadow-md"
            >
              {pending ? "Saving…" : "Save meal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddEntryDialog
        weekStartDate=""
        dayOfWeek={0}
        dayLabel=""
        recipes={recipes}
        open={pickRole !== null}
        onOpenChange={(o) => !o && setPickRole(null)}
        pick={{
          title: `Add a ${pickRole ? MEAL_ROLE_LABELS[pickRole].toLowerCase() : "dish"}`,
          onPick: addComponent,
          preferredIds:
            pickRole === null
              ? []
              : savedMeals.flatMap((m) =>
                  m.components.filter((c) => c.role === pickRole).map((c) => c.recipe.id)
                ),
        }}
      />

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.title}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The recipes stay in your library, and meals already on the plan keep their dishes.
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => confirmDelete && remove(confirmDelete)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
