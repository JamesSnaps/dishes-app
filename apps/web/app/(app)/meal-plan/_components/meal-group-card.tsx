"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  BookmarkPlus,
  CalendarDays,
  Check,
  ChefHat,
  Clock,
  GripVertical,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShoppingCart,
  SplitSquareVertical,
  Tag,
  Trash2,
  Unlink,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  ToastAction,
} from "@dishes/ui";
import { MEAL_ROLES, MEAL_ROLE_LABELS, type MealRole } from "@dishes/shared";
import { addMealGroupToShoppingList } from "@/app/actions/meal-plan";
import { saveMealGroupAsMeal, updateSavedMealFromGroup } from "@/app/actions/meals";
import type { ShoppingAddResult } from "@/lib/services/meal-plan";
import { notifyShoppingChanged } from "@/components/providers/shopping-count-context";
import { useSync } from "@/components/providers/sync-provider";
import { useToast } from "@/hooks/use-toast";
import { ComponentSuggestions } from "@/components/meals/component-suggestions";
import { AddEntryDialog } from "./add-entry-dialog";
import { MealScheduleDialog } from "./meal-schedule-dialog";
import { MEAL_BG, MEAL_COLOR, MEAL_ICON, MEAL_LABELS } from "./entry-card";
import type { PlanWriter } from "./plan-writer";
import type { SavedMeal } from "@/lib/services/meals";
import { slotName, withArticle } from "@/lib/saved-meals";
import type { Entry, PlannedGroup, Recipe } from "./week-planner";

type MealType = Entry["mealType"];

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const ROLE_CHIP: Record<MealRole, string> = {
  main: "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  side: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  sauce: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  other: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
};

/** Main first, then sides, sauces, extras. */
export function sortByRole(entries: Entry[]): Entry[] {
  return [...entries].sort(
    (a, b) => MEAL_ROLES.indexOf(a.mealRole ?? "side") - MEAL_ROLES.indexOf(b.mealRole ?? "side")
  );
}

/**
 * How long the whole meal takes, roughly. The dishes cook alongside each other,
 * so it's the longest one, not the sum — summing a roast's four dishes would
 * claim an afternoon.
 */
export function groupTotalMinutes(entries: Entry[]): number {
  return entries.reduce(
    (max, e) => Math.max(max, (e.recipe.prepTimeMinutes ?? 0) + (e.recipe.cookTimeMinutes ?? 0)),
    0
  );
}

function formatMinutes(total: number): string {
  return total < 60
    ? `${total}m`
    : `${Math.floor(total / 60)}h${total % 60 > 0 ? ` ${total % 60}m` : ""}`;
}

function servingsOf(entries: Entry[]): number | null {
  for (const e of entries) {
    const n = parseFloat(e.entryServings ?? e.recipe.servings ?? "");
    if (!isNaN(n)) return Math.round(n * 10) / 10;
  }
  return null;
}

interface Props {
  group: PlannedGroup;
  entries: Entry[];
  weekStartDate: string;
  recipes: Recipe[];
  writer: PlanWriter;
  /** Likely recipes for a role, for ordering the add/swap picker. */
  preferredFor: (role: MealRole) => string[];
  /** The saved meal this came from, if it still exists — its options become swap chips. */
  sourceMeal?: SavedMeal;
  dragNodeRef?: (node: HTMLLIElement | null) => void;
  dragListeners?: Record<string, unknown>;
  dragAttributes?: Record<string, unknown>;
  isDragging?: boolean;
}

type Picker = { kind: "add"; role: MealRole } | { kind: "swap"; entry: Entry };

export function MealGroupCard({
  group,
  entries,
  weekStartDate,
  recipes,
  writer,
  preferredFor,
  sourceMeal,
  dragNodeRef,
  dragListeners,
  dragAttributes,
  isDragging,
}: Props) {
  const router = useRouter();
  const sync = useSync();
  const { toast } = useToast();
  const [serverPending, startTransition] = useTransition();
  const pending = serverPending || writer.pending;

  const [renameOpen, setRenameOpen] = useState(false);
  const [titleInput, setTitleInput] = useState(group.title);
  const [servingsOpen, setServingsOpen] = useState(false);
  const [servingsInput, setServingsInput] = useState("");
  const [picker, setPicker] = useState<Picker | null>(null);
  const [addRole, setAddRole] = useState<MealRole>("side");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const dishes = sortByRole(entries);
  const total = groupTotalMinutes(entries);
  const servings = servingsOf(entries);
  const allOnList = entries.length > 0 && entries.every((e) => e.addedToShoppingListAt != null);
  const mealType = group.mealType as MealType;
  const hasSourceMeal = !!sourceMeal;
  // Only slots with a real choice get chips; a one-option slot has nothing to swap.
  const choiceSlots = sourceMeal?.slots.filter((s) => s.options.length > 1) ?? [];

  /**
   * One tap on an option chip. Single-choice slot: swap the dish filling it
   * (or add one if it's been removed). Pick-several slot: toggle that dish.
   */
  function toggleOption(slot: SavedMeal["slots"][number], recipeId: string) {
    const inSlot = entries.filter((e) => slot.options.some((o) => o.recipe.id === e.recipe.id));
    const existing = inSlot.find((e) => e.recipe.id === recipeId);

    if (slot.allowMultiple) {
      if (existing) writer.deleteEntry(existing.id);
      else addToMeal(recipeId, slot.role);
      return;
    }
    if (existing) return;
    if (inSlot[0]) writer.replaceEntryRecipe(inSlot[0].id, recipeId);
    else addToMeal(recipeId, slot.role);
  }

  function addToMeal(recipeId: string, role: MealRole) {
    writer.addEntry(weekStartDate, recipeId, group.dayOfWeek, mealType, {
      groupId: group.id,
      mealRole: role,
    });
  }

  /** Server actions stamp rows server-side; pull so the local store sees it. */
  function refreshFromServer() {
    void sync?.engine?.sync().catch(() => {});
    router.refresh();
  }

  // ── Whole-meal actions ────────────────────────────────────────────────────

  function addToShopping(forceInclude?: string[]) {
    startTransition(async () => {
      const result: ShoppingAddResult = await addMealGroupToShoppingList(
        group.id,
        forceInclude ? { forceInclude } : undefined
      );
      notifyShoppingChanged();
      refreshFromServer();

      const parts: string[] = [];
      if (result.added > 0) parts.push(`${result.added} added`);
      if (result.merged > 0) parts.push(`${result.merged} topped up`);
      if (!forceInclude && result.skipped.length > 0) {
        parts.push(`${result.skipped.length} already in your pantry`);
      }
      toast({
        title:
          result.added + result.merged > 0
            ? `${group.title} added to shopping list`
            : "Nothing added — it's all in your pantry",
        description: parts.join(" · ") || "These dishes have no ingredients.",
        action:
          !forceInclude && result.skipped.length > 0 ? (
            <ToastAction
              altText="Add the pantry-covered ingredients anyway"
              onClick={() => addToShopping(result.skipped)}
            >
              Add those too
            </ToastAction>
          ) : undefined,
      });
    });
  }

  function saveAsMeal() {
    startTransition(async () => {
      const res = await saveMealGroupAsMeal(group.id);
      if (!res.ok) {
        toast({ title: "Couldn't save the meal", description: res.error, variant: "destructive" });
        return;
      }
      refreshFromServer();
      toast({
        title: "Saved as a meal",
        description: `${group.title} is now in your saved meals.`,
      });
    });
  }

  function updateSavedMeal() {
    startTransition(async () => {
      const res = await updateSavedMealFromGroup(group.id);
      if (!res.ok) {
        toast({ title: "Couldn't update the saved meal", description: res.error, variant: "destructive" });
        return;
      }
      router.refresh();
      toast({ title: "Saved meal updated", description: `${group.title} now matches this plan.` });
    });
  }

  function saveTitle() {
    const t = titleInput.trim();
    if (t && t !== group.title) writer.updateGroup(group.id, { title: t });
    setRenameOpen(false);
  }

  function openServings() {
    setServingsInput(servings !== null ? String(servings) : "");
    setServingsOpen(true);
  }

  function saveServings() {
    const n = parseFloat(servingsInput);
    writer.updateGroup(group.id, { servings: !isNaN(n) && n > 0 ? n : null });
    setServingsOpen(false);
  }

  /**
   * Every dish's cook starts together, opening on the main; the others are a
   * tab away in cooking mode, timers and all.
   */
  function cookMeal() {
    const first = dishes[0];
    if (first) router.push(`/recipes/${first.recipe.id}/cook?meal=${group.id}`);
  }

  function handlePick(recipeId: string) {
    if (!picker) return;
    if (picker.kind === "swap") {
      writer.replaceEntryRecipe(picker.entry.id, recipeId);
    } else {
      addToMeal(recipeId, picker.role);
    }
    setPicker(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <li
        ref={dragNodeRef}
        {...(dragAttributes ?? {})}
        className={`list-none rounded-2xl overflow-hidden border border-orange-200/70 dark:border-orange-900/50 bg-gradient-to-br from-orange-50 via-amber-50/80 to-rose-50 dark:from-orange-950/30 dark:via-amber-950/15 dark:to-rose-950/25 shadow-md transition-all ${
          pending || isDragging ? "opacity-40" : ""
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-2 py-2.5">
          {dragListeners ? (
            <div
              {...dragListeners}
              className="flex-shrink-0 flex items-center justify-center px-1 cursor-grab active:cursor-grabbing touch-none text-orange-900/25 hover:text-orange-900/50 dark:text-orange-100/25 transition-colors"
              aria-label="Drag to move the whole meal to another day"
            >
              <GripVertical className="h-4 w-4" />
            </div>
          ) : (
            <span className="w-2" />
          )}

          <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-white flex items-center justify-center shadow-sm">
            <UtensilsCrossed className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-bold text-base leading-snug line-clamp-1">{group.title}</p>
            <div className="mt-0.5 flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${MEAL_BG[mealType]} ${MEAL_COLOR[mealType]}`}
              >
                {MEAL_ICON[mealType]}
                <span className="font-semibold">{MEAL_LABELS[mealType]}</span>
              </span>
              <span>
                {entries.length} dish{entries.length === 1 ? "" : "es"}
              </span>
              {total > 0 && (
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />~{formatMinutes(total)}
                </span>
              )}
              {servings !== null && (
                <span className="flex items-center gap-0.5">
                  <Users className="h-3 w-3" />
                  {servings}
                </span>
              )}
              {allOnList && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <Check className="h-3 w-3" />
                  <span className="font-semibold">On list</span>
                </span>
              )}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={pending}
                className="p-2 rounded-lg hover:bg-white/60 dark:hover:bg-black/20 transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Meal options"
              >
                <MoreVertical className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => addToShopping()}>
                <ShoppingCart className="h-4 w-4 mr-2" />
                {allOnList ? "Add meal to shopping list again" : "Add meal to shopping list"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
                <AlarmClock className="h-4 w-4 mr-2" />
                Cooking schedule…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openServings}>
                <Users className="h-4 w-4 mr-2" />
                Servings for everything{servings !== null && ` (${servings})`}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setTitleInput(group.title);
                  setRenameOpen(true);
                }}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Rename
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <CalendarDays className="h-4 w-4 mr-2" />
                  Move to…
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {DAY_NAMES.map((name, i) => (
                    <DropdownMenuItem
                      key={i}
                      disabled={i === group.dayOfWeek}
                      onClick={() => writer.updateGroup(group.id, { dayOfWeek: i })}
                    >
                      {name}
                      {i === group.dayOfWeek && (
                        <span className="ml-auto text-xs text-muted-foreground">current</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span className={`mr-2 ${MEAL_COLOR[mealType]}`}>{MEAL_ICON[mealType]}</span>
                  Change meal type…
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {(Object.keys(MEAL_LABELS) as MealType[]).map((type) => (
                    <DropdownMenuItem
                      key={type}
                      disabled={type === mealType}
                      onClick={() => writer.updateGroup(group.id, { mealType: type })}
                    >
                      <span className={`mr-2 ${MEAL_COLOR[type]}`}>{MEAL_ICON[type]}</span>
                      {MEAL_LABELS[type]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              {hasSourceMeal ? (
                <DropdownMenuItem onClick={updateSavedMeal}>
                  <Save className="h-4 w-4 mr-2" />
                  Update saved meal to match
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={saveAsMeal}>
                  <BookmarkPlus className="h-4 w-4 mr-2" />
                  Save as a meal
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => writer.deleteGroup(group.id, true)}>
                <SplitSquareVertical className="h-4 w-4 mr-2" />
                Split into separate dishes
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => writer.deleteGroup(group.id, false)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove meal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Quick swaps from the saved meal's options */}
        {choiceSlots.length > 0 && (
          <div className="mx-2 mb-2 space-y-1.5 rounded-xl bg-white/50 dark:bg-black/15 px-2.5 py-2">
            {choiceSlots.map((slot) => (
              <div key={slot.id} className="flex items-start gap-2">
                <span className="mt-1 w-12 shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground line-clamp-1">
                  {slotName(slot)}
                </span>
                <div className="flex flex-wrap gap-1">
                  {slot.options.map((o) => {
                    const on = entries.some((e) => e.recipe.id === o.recipe.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={pending}
                        aria-pressed={on}
                        onClick={() => toggleOption(slot, o.recipe.id)}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all ${
                          on
                            ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm"
                            : "border border-orange-200 dark:border-orange-900/60 bg-white dark:bg-black/30 text-muted-foreground hover:text-foreground hover:border-orange-400"
                        }`}
                      >
                        {o.recipe.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Dishes */}
        <ul className="mx-2 mb-2 rounded-xl bg-white/70 dark:bg-black/20 divide-y divide-orange-100 dark:divide-orange-950/60 shadow-sm">
          {dishes.map((entry) => {
            const role = entry.mealRole ?? "side";
            const thumb = entry.recipe.thumbnailUrl ?? entry.recipe.imageUrl;
            return (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-white/80 dark:hover:bg-white/5 first:rounded-t-xl last:rounded-b-xl transition-colors"
                onClick={() =>
                  router.push(`/recipes/${entry.recipe.id}?from=meal-plan&week=${weekStartDate}`)
                }
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="h-11 w-11 shrink-0 rounded-lg bg-muted flex items-center justify-center text-lg text-muted-foreground/40">
                    🍽
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <span
                    className={`inline-block rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${ROLE_CHIP[role]}`}
                  >
                    {MEAL_ROLE_LABELS[role]}
                  </span>
                  <p className="text-sm font-semibold leading-snug line-clamp-1">{entry.recipe.title}</p>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      disabled={pending}
                      className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      aria-label={`Options for ${entry.recipe.title}`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={() => router.push(`/recipes/${entry.recipe.id}/cook`)}>
                      <ChefHat className="h-4 w-4 mr-2" />
                      Cook
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setPicker({ kind: "swap", entry })}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Swap for another recipe…
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Tag className="h-4 w-4 mr-2" />
                        Role
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {MEAL_ROLES.map((r) => (
                          <DropdownMenuItem
                            key={r}
                            disabled={r === role}
                            onClick={() => writer.setEntryGroup(entry.id, group.id, r)}
                          >
                            {MEAL_ROLE_LABELS[r]}
                            {r === role && (
                              <span className="ml-auto text-xs text-muted-foreground">current</span>
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => writer.setEntryGroup(entry.id, null)}>
                      <Unlink className="h-4 w-4 mr-2" />
                      Take out of this meal
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => writer.deleteEntry(entry.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove from plan
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>

        {/* Cook the whole meal / add a dish */}
        <div className="px-2 pb-2 flex gap-2">
          {dishes.length > 0 && (
            <button
              type="button"
              onClick={cookMeal}
              disabled={pending}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 py-2 text-sm font-semibold text-white shadow-md transition-colors"
            >
              <ChefHat className="h-4 w-4" />
              Cook this meal
            </button>
          )}
          {dishes.length > 0 && (
            <button
              type="button"
              onClick={() => setScheduleOpen(true)}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-orange-300/70 dark:border-orange-800/60 bg-white/60 dark:bg-black/20 px-3 py-2 text-sm font-semibold text-orange-700 dark:text-orange-300 shadow-sm hover:bg-white dark:hover:bg-black/30 transition-colors"
              aria-label="Cooking schedule"
            >
              <AlarmClock className="h-4 w-4" />
              <span className="hidden sm:inline">Timing</span>
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={pending}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-orange-300/70 dark:border-orange-800/60 bg-white/60 dark:bg-black/20 py-2 text-sm font-semibold text-orange-700 dark:text-orange-300 shadow-sm hover:bg-white dark:hover:bg-black/30 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add a dish
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuItem onClick={() => setSuggestionsOpen(true)}>Suggest accompaniments…</DropdownMenuItem>
              {MEAL_ROLES.map((r) => (
                <DropdownMenuItem
                  key={r}
                  onClick={() => {
                    setAddRole(r);
                    setPicker({ kind: "add", role: r });
                  }}
                >
                  <span className={`mr-2 rounded-full px-1.5 text-[9px] font-bold uppercase ${ROLE_CHIP[r]}`}>
                    {MEAL_ROLE_LABELS[r]}
                  </span>
                  Add {withArticle(MEAL_ROLE_LABELS[r].toLowerCase())}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </li>

      <AddEntryDialog
        weekStartDate={weekStartDate}
        dayOfWeek={group.dayOfWeek}
        dayLabel={DAY_NAMES[group.dayOfWeek] ?? ""}
        recipes={recipes}
        open={picker !== null}
        onOpenChange={(o) => !o && setPicker(null)}
        pick={{
          title:
            picker?.kind === "swap"
              ? `Swap ${picker.entry.recipe.title}`
              : `Add ${withArticle(MEAL_ROLE_LABELS[addRole].toLowerCase())} to ${group.title}`,
          onPick: handlePick,
          preferredIds: [...recipes.filter((r) => r.mealRole === (picker?.kind === "swap" ? (picker.entry.mealRole ?? "side") : addRole)).map((r) => r.id), ...preferredFor(
            picker?.kind === "swap" ? (picker.entry.mealRole ?? "side") : addRole
          )],
        }}
      />

      <Dialog open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Complete {group.title}</DialogTitle></DialogHeader>
          {suggestionsOpen && <ComponentSuggestions mealTitle={group.title} recipeIds={entries.map((e) => e.recipe.id)} onAdd={(s) => { if (!entries.some((e) => e.recipe.id === s.recipeId)) addToMeal(s.recipeId, s.role); }} />}
        </DialogContent>
      </Dialog>
      <MealScheduleDialog groupId={group.id} open={scheduleOpen} onOpenChange={setScheduleOpen} />

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename meal</DialogTitle>
          </DialogHeader>
          <Input
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveTitle()}
            maxLength={200}
            autoFocus
          />
          <DialogFooter>
            <Button onClick={saveTitle} disabled={!titleInput.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={servingsOpen} onOpenChange={setServingsOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Servings for the whole meal</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              Every dish in {group.title} is scaled to this many people.
            </p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min="1"
                step="1"
                value={servingsInput}
                onChange={(e) => setServingsInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveServings()}
                className="w-24 text-center text-lg font-bold"
                autoFocus
              />
              <span className="text-sm text-muted-foreground">servings</span>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => {
                writer.updateGroup(group.id, { servings: null });
                setServingsOpen(false);
              }}
            >
              Use each recipe&apos;s default
            </Button>
            <Button onClick={saveServings} disabled={!servingsInput || parseFloat(servingsInput) <= 0}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
