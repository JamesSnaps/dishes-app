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

export type FilterableRecipe = {
  id: string;
  title: string;
  cuisine: string | null;
  difficulty?: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  isFavourite: boolean;
  tags?: string[];
  averageRating: number | null;
  cookCount: number;
  createdAt?: string | null;
};

export type RecipeFilters = {
  q?: string;
  cuisine?: string;
  favourites?: string;
  difficulty?: string;
  maxTime?: string;
  tags?: string;
  sort?: string;
};

const DIFFICULTIES = ["easy", "medium", "hard"];

export function hasActiveFilters(f: RecipeFilters): boolean {
  return Boolean(f.q || f.cuisine || f.favourites || f.difficulty || f.maxTime || f.tags);
}

export function filterRecipes<T extends FilterableRecipe>(
  recipes: T[],
  f: RecipeFilters
): T[] {
  let out = recipes;

  // Matches the SQL: title ILIKE, OR any tag ILIKE.
  const q = f.q?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  }

  const cuisine = f.cuisine?.trim();
  if (cuisine) out = out.filter((r) => r.cuisine === cuisine);

  if (f.favourites === "1") out = out.filter((r) => r.isFavourite);

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

  const tagList = f.tags?.split(",").filter(Boolean) ?? [];
  if (tagList.length) {
    // IN (…) semantics: any of the selected tags, not all of them.
    out = out.filter((r) => (r.tags ?? []).some((t) => tagList.includes(t)));
  }

  return out;
}

export function sortRecipes<T extends FilterableRecipe>(recipes: T[], sort?: string): T[] {
  const out = [...recipes];

  if (sort === "az") return out.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "rating") {
    return out.sort((a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1));
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

/** Distinct cuisines present, for the filter chips. */
export function cuisinesOf(recipes: FilterableRecipe[]): string[] {
  return [...new Set(recipes.map((r) => r.cuisine).filter((c): c is string => !!c))].sort();
}

/** Distinct tags present, for the filter chips. */
export function tagsOf(recipes: FilterableRecipe[]): string[] {
  return [...new Set(recipes.flatMap((r) => r.tags ?? []))].sort();
}
