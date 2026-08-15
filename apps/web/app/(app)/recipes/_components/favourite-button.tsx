"use client";

import { useTransition } from "react";
import { Heart } from "lucide-react";
import { toggleFavourite } from "@/app/actions/recipes";
import { useSync } from "@/components/providers/sync-provider";

interface Props {
  recipeId: string;
  isFavourite: boolean;
  size?: "sm" | "md";
}

export function FavouriteButton({ recipeId, isFavourite, size = "md" }: Props) {
  const [pending, startTransition] = useTransition();
  const sync = useSync();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    startTransition(async () => {
      /**
       * This button renders inside the recipes and favourites grids, both of
       * which read `isFavourite` from the local store. `toggleFavourite`
       * revalidates /recipes and /recipes/[id] but never /favourites, and a
       * server action can't touch the store anyway — so without the patch below
       * the heart doesn't move at all, and unfavouriting from the Favourites
       * screen leaves the card sitting there.
       *
       * Patched locally first so the tap is instant, then the action, then a
       * pull to reconcile. If the server disagrees, its row wins on that pull.
       */
      const engine = sync?.engine;
      await engine?.patchLocal("recipes", recipeId, { isFavourite: !isFavourite });

      await toggleFavourite(recipeId);

      void engine?.sync().catch(() => {});
    });
  }

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const btnSize = size === "sm" ? "h-7 w-7" : "h-8 w-8";

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      aria-label={isFavourite ? "Remove from favourites" : "Add to favourites"}
      className={`flex ${btnSize} items-center justify-center rounded-full bg-background/80 backdrop-blur-sm shadow-sm transition-opacity disabled:opacity-50 hover:scale-110 active:scale-95 transition-transform`}
    >
      <Heart
        className={`${iconSize} transition-colors ${
          isFavourite ? "fill-rose-500 text-rose-500" : "text-muted-foreground"
        }`}
      />
    </button>
  );
}
