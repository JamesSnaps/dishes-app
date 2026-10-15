"use client";

import { ComponentSuggestions } from "@/components/meals/component-suggestions";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Clock,
  Pencil,
  Plus,
  Star,
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
import { normaliseSavedMeals, slotName, withArticle } from "@/lib/saved-meals";
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

/** The longest dish's time, taking each slot's slowest option — a fair upper bound. */
function longestMinutes(meal: SavedMeal): number {
  return meal.slots.reduce(
    (max, slot) =>
      slot.options.reduce(
        (m, o) => Math.max(m, (o.recipe.prepTimeMinutes ?? 0) + (o.recipe.cookTimeMinutes ?? 0)),
        max
      ),
    0
  );
}

function formatMinutes(total: number): string {
  return total < 60
    ? `${total}m`
    : `${Math.floor(total / 60)}h${total % 60 > 0 ? ` ${total % 60}m` : ""}`;
}

type DraftOption = { key: string; recipeId: string; isDefault: boolean };
type DraftSlot = {
  key: string;
  role: MealRole;
  label: string;
  allowMultiple: boolean;
  options: DraftOption[];
};
type Draft = {
  id: string | null;
  title: string;
  defaultMealType: MealType;
  slots: DraftSlot[];
};

/** Where a pick from the recipe picker goes: a new dish, or another option for one. */
type PickTarget = { kind: "slot"; role: MealRole } | { kind: "option"; slotKey: string };

function emptyDraft(): Draft {
  return { id: null, title: "", defaultMealType: "dinner", slots: [] };
}

function draftFrom(meal: SavedMeal): Draft {
  return {
    id: meal.id,
    title: meal.title,
    defaultMealType: meal.defaultMealType,
    slots: meal.slots.map((s) => ({
      key: s.id,
      role: s.role,
      label: s.label ?? "",
      allowMultiple: s.allowMultiple,
      options: s.options.map((o) => ({ key: o.id, recipeId: o.recipe.id, isDefault: o.isDefault })),
    })),
  };
}

export function MealsManager({
  savedMeals: rawMeals,
  recipes,
}: {
  savedMeals: SavedMeal[];
  recipes: Recipe[];
}) {
  const savedMeals = normaliseSavedMeals(rawMeals);
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedMeal | null>(null);

  const recipeById = new Map(recipes.map((r) => [r.id, r]));

  function updateSlot(key: string, patch: (slot: DraftSlot) => DraftSlot) {
    setDraft((d) => d && { ...d, slots: d.slots.map((s) => (s.key === key ? patch(s) : s)) });
  }

  /** Tap an option: make it pre-selected (the only one, unless pick-several). */
  function toggleDefault(slot: DraftSlot, optionKey: string) {
    updateSlot(slot.key, (s) => ({
      ...s,
      options: s.options.map((o) =>
        s.allowMultiple
          ? o.key === optionKey
            ? { ...o, isDefault: !o.isDefault }
            : o
          : { ...o, isDefault: o.key === optionKey }
      ),
    }));
  }

  function removeOption(slot: DraftSlot, optionKey: string) {
    setDraft((d) => {
      if (!d) return d;
      const remaining = slot.options.filter((o) => o.key !== optionKey);
      // Removing the last option removes the dish.
      if (!remaining.length) return { ...d, slots: d.slots.filter((s) => s.key !== slot.key) };
      if (!slot.allowMultiple && !remaining.some((o) => o.isDefault)) {
        remaining[0] = { ...remaining[0]!, isDefault: true };
      }
      return {
        ...d,
        slots: d.slots.map((s) => (s.key === slot.key ? { ...s, options: remaining } : s)),
      };
    });
  }

  function setAllowMultiple(slot: DraftSlot, allowMultiple: boolean) {
    updateSlot(slot.key, (s) => {
      if (allowMultiple) return { ...s, allowMultiple };
      // Back to pick-one: keep a single default.
      const first = Math.max(0, s.options.findIndex((o) => o.isDefault));
      return {
        ...s,
        allowMultiple,
        options: s.options.map((o, i) => ({ ...o, isDefault: i === first })),
      };
    });
  }

  function handlePick(recipeId: string) {
    if (!draft || !pickTarget) return;
    const option = { key: crypto.randomUUID(), recipeId };
    if (pickTarget.kind === "slot") {
      setDraft({
        ...draft,
        slots: [
          ...draft.slots,
          {
            key: crypto.randomUUID(),
            role: pickTarget.role,
            label: "",
            allowMultiple: false,
            options: [{ ...option, isDefault: true }],
          },
        ],
      });
    } else {
      updateSlot(pickTarget.slotKey, (s) =>
        s.options.some((o) => o.recipeId === recipeId)
          ? s
          : { ...s, options: [...s.options, { ...option, isDefault: false }] }
      );
    }
    setPickTarget(null);
  }

  function save() {
    if (!draft) return;
    const input = {
      title: draft.title,
      defaultMealType: draft.defaultMealType,
      slots: draft.slots.map((s) => ({
        role: s.role,
        label: s.label,
        allowMultiple: s.allowMultiple,
        options: s.options.map(({ recipeId, isDefault }) => ({ recipeId, isDefault })),
      })),
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

  const sortedDraftSlots = draft
    ? [...draft.slots].sort((a, b) => MEAL_ROLES.indexOf(a.role) - MEAL_ROLES.indexOf(b.role))
    : [];

  const pickerSlot =
    pickTarget?.kind === "option" ? draft?.slots.find((s) => s.key === pickTarget.slotKey) : undefined;
  const pickerRole = pickTarget?.kind === "slot" ? pickTarget.role : pickerSlot?.role;

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Saved meals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Combinations you cook together. Give a dish several options — chicken, pork or beef —
            and choose when you plan it.
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
                        {meal.slots.length} dish{meal.slots.length === 1 ? "" : "es"}
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
                  {meal.slots.map((slot) => (
                    <li key={slot.id} className="flex items-start gap-2 px-2.5 py-2">
                      <span
                        className={`mt-0.5 shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${ROLE_CHIP[slot.role]}`}
                      >
                        {slotName(slot)}
                      </span>
                      <span className="text-sm min-w-0">
                        {slot.options.map((o, i) => (
                          <span key={o.id}>
                            {i > 0 && (
                              <span className="text-muted-foreground">
                                {slot.allowMultiple ? ", " : " / "}
                              </span>
                            )}
                            <Link
                              href={`/recipes/${o.recipe.id}`}
                              className={`hover:underline ${o.isDefault ? "font-semibold" : "text-muted-foreground"}`}
                            >
                              {o.recipe.title}
                            </Link>
                          </span>
                        ))}
                      </span>
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
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit meal" : "New meal"}</DialogTitle>
          </DialogHeader>

          {draft && (
            <div className="space-y-4 overflow-y-auto -mx-2 px-2 py-1">
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
                {sortedDraftSlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground mb-2">Add the dishes that make up this meal.</p>
                ) : (
                  <p className="text-xs text-muted-foreground mb-2">
                    Give a dish more than one option to choose between when you plan it. The starred
                    option is ticked first — after that, it remembers what you chose last time.
                  </p>
                )}

                <ul className="space-y-2.5">
                  {sortedDraftSlots.map((slot) => (
                    <li
                      key={slot.key}
                      className="rounded-xl border border-orange-200/70 dark:border-orange-900/50 bg-gradient-to-br from-orange-50 to-rose-50 dark:from-orange-950/30 dark:to-rose-950/20 p-3 shadow-sm space-y-2.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <div className="flex flex-wrap gap-1 flex-1">
                          {MEAL_ROLES.map((r) => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => updateSlot(slot.key, (s) => ({ ...s, role: r }))}
                              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all ${
                                slot.role === r
                                  ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm"
                                  : "bg-white dark:bg-black/30 border text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {MEAL_ROLE_LABELS[r]}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({ ...draft, slots: draft.slots.filter((s) => s.key !== slot.key) })
                          }
                          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          aria-label="Remove dish"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <Input
                        value={slot.label}
                        onChange={(e) => updateSlot(slot.key, (s) => ({ ...s, label: e.target.value }))}
                        placeholder={`Name (optional) — e.g. ${slot.role === "main" ? "Meat" : "Veg"}`}
                        maxLength={100}
                        className="h-8 text-sm bg-white/80 dark:bg-black/20"
                      />

                      <div className="flex flex-wrap gap-1.5">
                        {slot.options.map((o) => (
                          <span
                            key={o.key}
                            className={`inline-flex items-center rounded-full text-xs font-semibold shadow-sm ${
                              o.isDefault
                                ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white"
                                : "bg-white dark:bg-black/30 border text-foreground"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleDefault(slot, o.key)}
                              className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1"
                              aria-pressed={o.isDefault}
                              aria-label={`${recipeById.get(o.recipeId)?.title ?? "Recipe"}${o.isDefault ? " — ticked first" : ""}`}
                              title={o.isDefault ? "Ticked first" : "Tick first"}
                            >
                              <Star className={`h-3 w-3 ${o.isDefault ? "fill-current" : "opacity-40"}`} />
                              {recipeById.get(o.recipeId)?.title ?? "Recipe"}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeOption(slot, o.key)}
                              className="pr-2 pl-0.5 py-1 opacity-70 hover:opacity-100"
                              aria-label="Remove option"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        <button
                          type="button"
                          onClick={() => setPickTarget({ kind: "option", slotKey: slot.key })}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-orange-400 px-2.5 py-1 text-xs font-semibold text-orange-700 dark:text-orange-300 hover:bg-white/70 dark:hover:bg-black/20"
                        >
                          <Plus className="h-3 w-3" />
                          Option
                        </button>
                      </div>

                      {slot.options.length > 1 && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={slot.allowMultiple}
                          onClick={() => setAllowMultiple(slot, !slot.allowMultiple)}
                          className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
                        >
                          <span
                            className={`relative h-4 w-7 rounded-full transition-colors ${
                              slot.allowMultiple ? "bg-orange-500" : "bg-muted-foreground/30"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
                                slot.allowMultiple ? "left-3.5" : "left-0.5"
                              }`}
                            />
                          </span>
                          Pick several (e.g. veg) rather than one
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                <ComponentSuggestions
                  key={draft.id ?? "new"}
                  excludedRecipeIds={draft.slots.flatMap((s) => s.options.map((o) => o.recipeId))}
                  mealTitle={draft.title}
                  recipeIds={draft.slots.flatMap((s) => s.options.filter((o) => o.isDefault).map((o) => o.recipeId))}
                  onAdd={(suggestion) => setDraft((d) => d && !d.slots.some((s) => s.options.some((o) => o.recipeId === suggestion.recipeId)) ? ({ ...d, slots: [...d.slots, { key: crypto.randomUUID(), role: suggestion.role, label: "", allowMultiple: false, options: [{ key: crypto.randomUUID(), recipeId: suggestion.recipeId, isDefault: true }] }] }) : d)}
                />
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {MEAL_ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setPickTarget({ kind: "slot", role: r })}
                      className="flex items-center justify-center gap-1 rounded-xl border border-orange-300/70 dark:border-orange-800/60 bg-white/70 dark:bg-black/20 py-1.5 text-xs font-semibold text-orange-700 dark:text-orange-300 shadow-sm hover:bg-white dark:hover:bg-black/30 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add {withArticle(MEAL_ROLE_LABELS[r].toLowerCase())}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={save}
              disabled={pending || !draft?.title.trim() || !draft?.slots.length}
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
        open={pickTarget !== null}
        onOpenChange={(o) => !o && setPickTarget(null)}
        pick={{
          title:
            pickTarget?.kind === "option" && pickerSlot
              ? `Another option for ${slotName({ label: pickerSlot.label, role: pickerSlot.role }).toLowerCase()}`
              : `Add ${withArticle(pickerRole ? MEAL_ROLE_LABELS[pickerRole].toLowerCase() : "dish")}`,
          onPick: handlePick,
          preferredIds: pickerRole
            ? [...recipes.filter((r) => r.mealRole === pickerRole).map((r) => r.id), ...savedMeals.flatMap((m) =>
                m.slots
                  .filter((s) => s.role === pickerRole)
                  .flatMap((s) => s.options.map((o) => o.recipe.id))
              )]
            : [],
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
