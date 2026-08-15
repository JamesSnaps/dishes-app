"use client";

import { useFavouritesCount } from "./favourites-grid";

/** Header count, from the local store once it has data. */
export function FavouritesHeader({ initialCount }: { initialCount: number }) {
  const count = useFavouritesCount(initialCount);

  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold">Favourites</h1>
      <p className="text-sm text-muted-foreground mt-0.5">
        {count} recipe{count !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
