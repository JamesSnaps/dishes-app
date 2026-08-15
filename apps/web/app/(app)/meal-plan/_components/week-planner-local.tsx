"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useSync, useSyncedCollection } from "@/components/providers/sync-provider";
import {
  WeekPlanner,
  type Entry,
  type Recipe,
  type TopIngredient,
  type WeekPlannerProps,
} from "./week-planner";

/**
 * Meal plan week, read from the local store when one is populated.
 *
 * Same shape as the Favourites and Recipes conversions: the server render is
 * passed in as `initial`, so first paint is unchanged and the page behaves
 * exactly as before without a local store. The synced copy takes over once the
 * engine has data.
 *
 * `WeekPlanner` itself is untouched — its ~690 lines of drag-and-drop, per-entry
 * menus and shopping flows keep working against the same props.
 *
 * ── Why the mapping below is so explicit ─────────────────────────────────────
 * Synced records are untyped (`SyncRecord`), so a cast to `Recipe` would compile
 * happily while leaving fields undefined at runtime — which is exactly how the
 * first attempt at this conversion died, with `r.tags is not iterable` thrown
 * from `AddEntryDialog`'s tag collection. Every field therefore goes through a
 * narrowing helper that produces the same defaults the server applies in
 * `page.tsx` (`?? []`, `?? null`), and the result is a checked object literal.
 * Nothing reaches the picker half-built, whatever the store contains.
 */

type SyncRow = Record<string, unknown> & { id: string };

// ── Narrowing helpers: unknown → the prop types, never a cast ────────────────

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Decimal columns arrive as strings over the wire; keep them as strings. */
function decimalStr(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function date(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "dessert", "snack"] as const;

/** `find` rather than `includes` + cast, so the compiler derives the union. */
function difficulty(v: unknown) {
  return DIFFICULTIES.find((d) => d === v) ?? null;
}

function mealType(v: unknown) {
  return MEAL_TYPES.find((m) => m === v) ?? "dinner";
}

/** Ingredient rows on a synced recipe document. */
function ingredientNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const name = (row as Record<string, unknown>).ingredientName;
    return typeof name === "string" ? [name] : [];
  });
}

// ── Derivations that mirror the server queries in page.tsx ───────────────────

/**
 * Average rating per recipe, on the 0–5 scale the picker displays.
 * `cook_history.rating` is stored 0–10 (half-star precision) and every row
 * counts, cooked or not — matching the `avg(cookHistory.rating)` query.
 */
function avgRatingsFrom(cooks: SyncRow[]): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>();

  for (const row of cooks) {
    const recipeId = str(row.recipeId);
    if (!recipeId) continue;

    const raw = row.rating;
    const rating = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isNaN(rating)) continue;

    const a = acc.get(recipeId) ?? { sum: 0, n: 0 };
    a.sum += rating;
    a.n += 1;
    acc.set(recipeId, a);
  }

  return new Map([...acc].map(([id, a]) => [id, a.sum / a.n / 2]));
}

function toPickerRecipe(r: SyncRow, avgRating: number | null): Recipe {
  return {
    id: r.id,
    title: str(r.title) ?? "",
    cuisine: str(r.cuisine),
    difficulty: difficulty(r.difficulty),
    thumbnailUrl: str(r.thumbnailUrl),
    imageUrl: str(r.imageUrl),
    prepTimeMinutes: num(r.prepTimeMinutes),
    cookTimeMinutes: num(r.cookTimeMinutes),
    isFavourite: r.isFavourite === true,
    tags: strArray(r.tags),
    avgRating,
    ingredientNames: ingredientNames(r.ingredients),
  };
}

function toEntry(e: SyncRow, recipe: SyncRow): Entry {
  return {
    id: e.id,
    dayOfWeek: num(e.dayOfWeek) ?? 0,
    mealType: mealType(e.mealType),
    entryServings: decimalStr(e.servings),
    addedToShoppingListAt: date(e.addedToShoppingListAt),
    recipe: {
      id: recipe.id,
      title: str(recipe.title) ?? "",
      prepTimeMinutes: num(recipe.prepTimeMinutes),
      cookTimeMinutes: num(recipe.cookTimeMinutes),
      servings: decimalStr(recipe.servings),
      imageUrl: str(recipe.imageUrl),
      thumbnailUrl: str(recipe.thumbnailUrl),
    },
  };
}

/** Top 8 ingredients across the week's distinct recipes, as page.tsx computes. */
function topIngredientsFrom(entries: Entry[], byId: Map<string, SyncRow>): TopIngredient[] {
  const recipeIds = [...new Set(entries.map((e) => e.recipe.id))];
  const counts = new Map<string, number>();

  for (const id of recipeIds) {
    const recipe = byId.get(id);
    if (!recipe) continue;
    for (const raw of ingredientNames(recipe.ingredients)) {
      const name = raw.toLowerCase().trim();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));
}

// ── Week maths, mirroring page.tsx ───────────────────────────────────────────

/** Monday of the week containing `dateStr` (or today), as YYYY-MM-DD. */
function mondayOf(dateStr?: string | null): string {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  if (Number.isNaN(d.getTime())) return mondayOf();
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

/** 0=Mon … 6=Sun, matching `dayOfWeek` on an entry. */
function todayIndex(): number {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
}

/** Unchecked items on the oldest active list — the same list page.tsx counts. */
function shoppingCountFrom(lists: SyncRow[], items: SyncRow[]): number {
  const active = lists
    .filter((l) => l.status === "active")
    .sort((a, b) => (str(a.createdAt) ?? "").localeCompare(str(b.createdAt) ?? ""))[0];

  if (!active) return 0;
  return items.filter((i) => i.listId === active.id && i.isChecked !== true).length;
}

// ── Component ────────────────────────────────────────────────────────────────

type Props = Pick<
  WeekPlannerProps,
  "weekStartDate" | "isCurrentWeek" | "todayDayIndex"
> & {
  initial: Pick<
    WeekPlannerProps,
    "planId" | "entries" | "recipes" | "topIngredients" | "shoppingItemCount"
  >;
};

export function WeekPlannerLocal({
  weekStartDate,
  isCurrentWeek,
  todayDayIndex,
  initial,
}: Props) {
  const sync = useSync();
  const params = useSearchParams();

  const { data: syncedRecipes, loading } = useSyncedCollection<SyncRow>("recipes");
  const { data: cooks } = useSyncedCollection<SyncRow>("cookHistory");
  const { data: plans } = useSyncedCollection<SyncRow>("mealPlans");
  const { data: planEntries } = useSyncedCollection<SyncRow>("mealPlanEntries");
  const { data: lists } = useSyncedCollection<SyncRow>("shoppingLists");
  const { data: items } = useSyncedCollection<SyncRow>("shoppingItems");

  const useLocal = Boolean(sync?.engine) && !loading && syncedRecipes.length > 0;

  /**
   * Which week is on screen.
   *
   * The server prop is authoritative until the store can take over. After that
   * the URL is, because `onNavigateWeek` moves between weeks with
   * `history.pushState` — Next syncs `useSearchParams` from it without fetching
   * an RSC payload, so the week has to be derived here or nothing would
   * re-render.
   *
   * `useLocal` is false during SSR and the first client render, so both agree
   * on the server's value at hydration and only diverge afterwards.
   */
  const week = useLocal ? mondayOf(params.get("week")) : weekStartDate;
  const currentWeek = useLocal ? week === mondayOf() : isCurrentWeek;
  const dayIndex = useLocal ? (currentWeek ? todayIndex() : -1) : todayDayIndex;

  // Memoised on the store arrays, not rebuilt per render: WeekPlanner copies
  // `entries` into state via an effect keyed on its identity, so a fresh array
  // every render would loop.
  const local = useMemo(() => {
    if (!useLocal) return null;

    const byId = new Map(syncedRecipes.map((r) => [r.id, r]));
    const ratings = avgRatingsFrom(cooks);

    const recipes = syncedRecipes
      .map((r) => toPickerRecipe(r, ratings.get(r.id) ?? null))
      .sort((a, b) => a.title.localeCompare(b.title));

    const plan = plans.find((p) => str(p.weekStartDate) === week) ?? null;

    const entries = plan
      ? planEntries.flatMap((e) => {
          if (e.mealPlanId !== plan.id) return [];
          const recipe = byId.get(str(e.recipeId) ?? "");
          // innerJoin on the server: an entry whose recipe is missing locally
          // is dropped rather than rendered half-empty.
          return recipe ? [toEntry(e, recipe)] : [];
        })
      : [];

    return {
      planId: plan ? plan.id : null,
      entries,
      recipes,
      topIngredients: topIngredientsFrom(entries, byId),
      shoppingItemCount: shoppingCountFrom(lists, items),
    };
  }, [useLocal, syncedRecipes, cooks, plans, planEntries, lists, items, week]);

  /**
   * Drag between days, pushed through the sync engine rather than the server
   * action. The optimistic store write lands immediately, so the move survives
   * the re-read that `onChange` triggers; the queued mutation goes out on the
   * sync that follows.
   *
   * No rollback here on purpose. A mutation the server rejects is dropped from
   * the queue by the engine (it would never succeed on a retry), and the next
   * pull carries the server's version of the entry — which restores the old day
   * without any bookkeeping on this side.
   */
  const engine = sync?.engine ?? null;
  const syncNow = sync?.sync;

  const handleMoveEntry = useCallback(
    (entryId: string, newDay: number) => {
      if (!engine) return;

      const row = planEntries.find((e) => e.id === entryId);

      engine
        .mutate(
          "meal_plan_entry.update",
          { entryId, dayOfWeek: newDay },
          row
            ? { collection: "mealPlanEntries", record: { ...row, dayOfWeek: newDay } }
            : undefined
        )
        .then(() => syncNow?.())
        .catch(() => {
          // Queueing failed (IndexedDB unavailable). The drag is already undone
          // by the next re-read, so there is nothing to unwind.
        });
    },
    [engine, planEntries, syncNow]
  );

  /**
   * Week change without a server round-trip. `router.push` is not called at
   * all, so Next fetches nothing; the URL is updated and the store serves the
   * target week. Back/forward still work — Next listens for popstate and
   * re-syncs `useSearchParams`, which flows back through `week` above.
   */
  const handleNavigateWeek = useCallback((target: string) => {
    window.history.pushState(null, "", `/meal-plan?week=${target}`);
  }, []);

  const data = local ?? initial;

  return (
    <WeekPlanner
      weekStartDate={week}
      isCurrentWeek={currentWeek}
      todayDayIndex={dayIndex}
      planId={data.planId}
      entries={data.entries}
      recipes={data.recipes}
      topIngredients={data.topIngredients}
      shoppingItemCount={data.shoppingItemCount}
      // Only when the local store is driving the screen: against `initial`,
      // the entry ids are the same but nothing would re-read the result.
      onMoveEntry={local ? handleMoveEntry : undefined}
      onNavigateWeek={local ? handleNavigateWeek : undefined}
    />
  );
}
