"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { useSync, useSyncedCollection } from "@/components/providers/sync-provider";
import { RecipeCard } from "../../recipes/_components/recipe-card";

/**
 * Favourites, read from the local store.
 *
 * The server still renders this list, and that render is passed in as
 * `initial` — so the first paint is immediate and identical to before, with no
 * loading state and nothing lost if IndexedDB is unavailable or empty.
 *
 * Once the sync engine has data, the local copy takes over: navigating back to
 * this page, or toggling a favourite elsewhere, updates it without a network
 * round-trip. This is the stale-while-revalidate shape the whole local-first
 * effort is aiming at, on the simplest screen that exercises it.
 */

export type FavouriteRecipe = {
  id: string;
  title: string;
  description: string | null;
  cuisine: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  calories?: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  isFavourite: boolean;
  isAiGenerated: boolean;
  averageRating: number | null;
  cookCount: number;
};

type SyncedRecipe = Record<string, unknown> & { id: string };
type SyncedCook = Record<string, unknown> & { id: string };

/**
 * Same rule the server applies: the average spans every entry, but only
 * entries with source 'cook' count as cooks. Kept deliberately in step with
 * `getCookStats` — if that rule changes, both need updating.
 */
function cookStatsFrom(cooks: SyncedCook[]) {
  const byRecipe = new Map<string, { sum: number; rated: number; cooks: number }>();

  for (const entry of cooks) {
    const recipeId = entry.recipeId as string | undefined;
    if (!recipeId) continue;

    const acc = byRecipe.get(recipeId) ?? { sum: 0, rated: 0, cooks: 0 };
    const rating = entry.rating == null ? null : Number(entry.rating);
    if (rating != null && !Number.isNaN(rating)) {
      acc.sum += rating;
      acc.rated += 1;
    }
    if (entry.source === "cook") acc.cooks += 1;

    byRecipe.set(recipeId, acc);
  }

  return new Map(
    [...byRecipe].map(([recipeId, a]) => [
      recipeId,
      {
        averageRating: a.rated ? Math.round((a.sum / a.rated) * 10) / 10 : null,
        cookCount: a.cooks,
      },
    ])
  );
}

function toFavourites(
  recipes: SyncedRecipe[],
  cooks: SyncedCook[]
): FavouriteRecipe[] {
  const stats = cookStatsFrom(cooks);

  return recipes
    .filter((r) => r.isFavourite === true)
    .map((r) => {
      const s = stats.get(r.id);
      return {
        id: r.id,
        title: (r.title as string) ?? "",
        description: (r.description as string | null) ?? null,
        cuisine: (r.cuisine as string | null) ?? null,
        prepTimeMinutes: (r.prepTimeMinutes as number | null) ?? null,
        cookTimeMinutes: (r.cookTimeMinutes as number | null) ?? null,
        calories: (r.calories as number | null) ?? null,
        imageUrl: (r.imageUrl as string | null) ?? null,
        thumbnailUrl: (r.thumbnailUrl as string | null) ?? null,
        isFavourite: true,
        isAiGenerated: r.isAiGenerated === true,
        averageRating: s?.averageRating ?? null,
        cookCount: s?.cookCount ?? 0,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function FavouritesGrid({ initial }: { initial: FavouriteRecipe[] }) {
  const sync = useSync();
  const { data: recipes, loading } = useSyncedCollection<SyncedRecipe>("recipes");
  const { data: cooks } = useSyncedCollection<SyncedCook>("cookHistory");

  // Prefer the local copy, but only once there is one. Before the first sync
  // completes — or with sync unavailable — the server's render stands, so this
  // page is never worse than it was.
  const useLocal = Boolean(sync?.engine) && !loading && recipes.length > 0;
  const list = useLocal ? toFavourites(recipes, cooks) : initial;

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <Heart className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-muted-foreground">No favourites yet.</p>
        <p className="text-sm text-muted-foreground/60">
          Tap the heart on any{" "}
          <Link
            href="/recipes"
            className="underline underline-offset-2 hover:text-foreground"
          >
            recipe
          </Link>{" "}
          to save it here.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {list.length} favourite recipes
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {list.map((recipe) => (
          <RecipeCard key={recipe.id} {...recipe} />
        ))}
      </div>
    </>
  );
}

/** Count for the header, kept in step with the grid's own source of truth. */
export function useFavouritesCount(initial: number): number {
  const sync = useSync();
  const { data: recipes, loading } = useSyncedCollection<SyncedRecipe>("recipes");

  if (!sync?.engine || loading || recipes.length === 0) return initial;
  return recipes.filter((r) => r.isFavourite === true).length;
}
