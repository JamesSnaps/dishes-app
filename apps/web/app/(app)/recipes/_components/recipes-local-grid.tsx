"use client";

import { useSearchParams } from "next/navigation";
import { useSync, useSyncedCollection } from "@/components/providers/sync-provider";
import {
  filterAndSortRecipes,
  type FilterableRecipe,
} from "@/lib/recipe-filtering";
import { RecipesGrid } from "./recipes-grid";

/**
 * Recipes list, read from the local store when one is populated.
 *
 * Same shape as the Favourites conversion: the server's filtered render is
 * passed in as `initial`, so first paint is unchanged and the page behaves
 * exactly as before without a local store. The synced copy takes over once the
 * engine has data — which is what makes returning to this page, and browsing
 * offline, work without a round-trip.
 *
 * Filtering and sorting are applied here from the URL, using the same rules as
 * the server query (see lib/recipe-filtering.ts). The two must stay in step.
 */

type GridRecipe = FilterableRecipe & {
  description: string | null;
  calories: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  isAiGenerated: boolean;
};

type SyncedRecipe = Record<string, unknown> & { id: string };
type SyncedCook = Record<string, unknown> & { id: string };

/**
 * Same rule as `getCookStats` on the server: the average spans every entry, but
 * only entries with source 'cook' count as cooks. Duplicated deliberately —
 * the server can't compute this for a client that's offline — but the two must
 * move together.
 */
function cookStatsFrom(cooks: SyncedCook[]) {
  const acc = new Map<string, { sum: number; rated: number; cooks: number }>();

  for (const entry of cooks) {
    const recipeId = entry.recipeId as string | undefined;
    if (!recipeId) continue;

    const a = acc.get(recipeId) ?? { sum: 0, rated: 0, cooks: 0 };
    const rating = entry.rating == null ? null : Number(entry.rating);
    if (rating != null && !Number.isNaN(rating)) {
      a.sum += rating;
      a.rated += 1;
    }
    if (entry.source === "cook") a.cooks += 1;
    acc.set(recipeId, a);
  }

  return new Map(
    [...acc].map(([id, a]) => [
      id,
      {
        averageRating: a.rated ? Math.round((a.sum / a.rated) * 10) / 10 : null,
        cookCount: a.cooks,
      },
    ])
  );
}

function toGridRecipes(recipes: SyncedRecipe[], cooks: SyncedCook[]): GridRecipe[] {
  const stats = cookStatsFrom(cooks);

  return recipes.map((r) => {
    const s = stats.get(r.id);
    return {
      id: r.id,
      title: (r.title as string) ?? "",
      description: (r.description as string | null) ?? null,
      cuisine: (r.cuisine as string | null) ?? null,
      difficulty: (r.difficulty as string | null) ?? null,
      prepTimeMinutes: (r.prepTimeMinutes as number | null) ?? null,
      cookTimeMinutes: (r.cookTimeMinutes as number | null) ?? null,
      calories: (r.calories as number | null) ?? null,
      imageUrl: (r.imageUrl as string | null) ?? null,
      thumbnailUrl: (r.thumbnailUrl as string | null) ?? null,
      isFavourite: r.isFavourite === true,
      isAiGenerated: r.isAiGenerated === true,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      createdAt:
        typeof r.createdAt === "string"
          ? r.createdAt
          : r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : null,
      averageRating: s?.averageRating ?? null,
      cookCount: s?.cookCount ?? 0,
    };
  });
}

export function RecipesLocalGrid({
  initial,
  allTags,
}: {
  initial: GridRecipe[];
  allTags: string[];
}) {
  const sync = useSync();
  const params = useSearchParams();

  const { data: recipes, loading } = useSyncedCollection<SyncedRecipe>("recipes");
  const { data: cooks } = useSyncedCollection<SyncedCook>("cookHistory");

  const useLocal = Boolean(sync?.engine) && !loading && recipes.length > 0;

  const list = useLocal
    ? filterAndSortRecipes(toGridRecipes(recipes, cooks), {
        q: params.get("q") ?? undefined,
        cuisine: params.get("cuisine") ?? undefined,
        favourites: params.get("favourites") ?? undefined,
        difficulty: params.get("difficulty") ?? undefined,
        maxTime: params.get("maxTime") ?? undefined,
        tags: params.get("tags") ?? undefined,
        sort: params.get("sort") ?? undefined,
      })
    : initial;

  return <RecipesGrid recipes={list} allTags={allTags} />;
}
