/**
 * Client-side recipe filtering and sorting.
 *
 * A deliberate mirror of the SQL in `app/(app)/recipes/page.tsx`. The server
 * still filters for first paint (and for a client with no local store), so the
 * two must agree — any change to the query belongs here too, and vice versa.
 *
 * Kept as pure functions with no React and no store access so the behaviour can
 * be reasoned about, and reused by the native app later.
 */

import { isMealRole } from "@dishes/shared";
import { isHeartHealthy } from "./heart-healthy";

export type FilterableRecipe = {
  id: string;
  title: string;
  cuisine: string | null;
  mealRole?: string | null;
  difficulty?: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  isFavourite: boolean;
  tags?: string[];
  ingredientNames?: string[];
  saturatedFatG?: number | string | null;
  fiberG?: number | string | null;
  averageRating: number | null;
  cookCount: number;
  /** ISO timestamp of the last cook (not a rating-only entry), for the "cooked" sort. */
  lastCookedAt?: string | null;
  createdAt?: string | null;
};

export type RecipeFilters = {
  q?: string;
  cuisine?: string;
  role?: string;
  favourites?: string;
  heart?: string;
  difficulty?: string;
  maxTime?: string;
  tags?: string;
  sort?: string;
  /** "all": the whole library as a grid, rather than browse mode's shelves. */
  view?: string;
};

const DIFFICULTIES = ["easy", "medium", "hard"];

export function hasActiveFilters(f: RecipeFilters): boolean {
  return Boolean(f.role || f.q || f.cuisine || f.favourites || f.heart || f.difficulty || f.maxTime || f.tags);
}

/**
 * Browse mode — tonight's meal and shelves of recipes instead of the grid —
 * is what /recipes shows with nothing searched, filtered, sorted or `view=all`.
 * The iOS app's RecipesScreen follows the same rule.
 */
export function isBrowsing(f: RecipeFilters): boolean {
  return !hasActiveFilters(f) && !f.sort && f.view !== "all";
}

export function filterRecipes<T extends FilterableRecipe>(
  recipes: T[],
  f: RecipeFilters
): T[] {
  let out = recipes;
  if (isMealRole(f.role)) out = out.filter((r) => r.mealRole === f.role);

  // Matches the SQL: title ILIKE, OR any tag ILIKE, OR any ingredient name ILIKE.
  const q = f.q?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
        (r.ingredientNames ?? []).some((i) => i.toLowerCase().includes(q))
    );
  }

  // Case-insensitive, like the SQL's lower() = lower(): "american" and
  // "American" are one cuisine (see mergeCaseVariants).
  const cuisine = f.cuisine?.trim().toLowerCase();
  if (cuisine) out = out.filter((r) => r.cuisine?.toLowerCase() === cuisine);

  if (f.favourites === "1") out = out.filter((r) => r.isFavourite);

  if (f.heart === "1") out = out.filter(isHeartHealthy);

  const difficulty = f.difficulty?.trim();
  if (difficulty && DIFFICULTIES.includes(difficulty)) {
    out = out.filter((r) => r.difficulty === difficulty);
  }

  const maxMinutes = f.maxTime?.trim() ? parseInt(f.maxTime) : NaN;
  if (!Number.isNaN(maxMinutes)) {
    // The SQL requires at least one time to be set, then sums with COALESCE —
    // so a recipe with no times at all is excluded rather than treated as 0.
    out = out.filter(
      (r) =>
        (r.prepTimeMinutes != null || r.cookTimeMinutes != null) &&
        (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0) <= maxMinutes
    );
  }

  const tagList = parseTags(f.tags).map((t) => t.toLowerCase());
  if (tagList.length) {
    // IN (…) semantics: any of the selected tags, not all of them. Case-insensitive.
    out = out.filter((r) => (r.tags ?? []).some((t) => tagList.includes(t.toLowerCase())));
  }

  return out;
}

export function sortRecipes<T extends FilterableRecipe>(recipes: T[], sort?: string): T[] {
  const out = [...recipes];

  if (sort === "az") return out.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "rating") {
    return out.sort((a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1));
  }
  // Most recently cooked first; never-cooked recipes last.
  if (sort === "cooked") {
    return out.sort((a, b) => (b.lastCookedAt ?? "").localeCompare(a.lastCookedAt ?? ""));
  }

  // "newest" — the server got this from ORDER BY created_at DESC. Locally we
  // have to sort explicitly, since store order is not insertion order.
  return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export function filterAndSortRecipes<T extends FilterableRecipe>(
  recipes: T[],
  f: RecipeFilters
): T[] {
  return sortRecipes(filterRecipes(recipes, f), f.sort);
}

/** The `tags` URL param as a list. */
export function parseTags(tags: string | null | undefined): string[] {
  return (tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

/** A cuisine or tag the filter panel offers, and how many recipes have it. */
export type FacetOption = { value: string; count: number };

function capitals(s: string): number {
  return s.replace(/[^A-Z]/g, "").length;
}

/**
 * Fold spellings that differ only in case ("Italian-American" and
 * "Italian-american", "british" and "British") into one option. Cuisines and
 * tags are free text, often AI-written, so these pile up. The filters match
 * case-insensitively, so any spelling selects them all; the one shown is the
 * most capitalised, then the most used.
 */
export function mergeCaseVariants(options: FacetOption[]): FacetOption[] {
  const groups = new Map<string, { best: FacetOption; count: number }>();
  for (const o of options) {
    const key = o.value.trim().toLowerCase();
    if (!key) continue;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { best: o, count: o.count });
      continue;
    }
    g.count += o.count;
    const better =
      capitals(o.value) > capitals(g.best.value) ||
      (capitals(o.value) === capitals(g.best.value) && o.count > g.best.count);
    if (better) g.best = o;
  }
  return [...groups.values()]
    .map((g) => ({ value: g.best.value.trim(), count: g.count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

/** Distinct cuisines present, for the filter chips. */
export function cuisinesOf(recipes: FilterableRecipe[]): string[] {
  return [...new Set(recipes.map((r) => r.cuisine).filter((c): c is string => !!c))].sort();
}

/** Distinct tags present, for the filter chips. */
export function tagsOf(recipes: FilterableRecipe[]): string[] {
  return [...new Set(recipes.flatMap((r) => r.tags ?? []))].sort();
}
