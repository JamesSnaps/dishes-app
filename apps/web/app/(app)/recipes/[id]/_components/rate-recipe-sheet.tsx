"use client";

import { useState, useTransition } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@dishes/ui";
import { Button, Textarea } from "@dishes/ui";
import { StarRating } from "./star-rating";
import { rateRecipe } from "@/app/actions/cook-history";

interface RateRecipeSheetProps {
  recipeId: string;
  recipeTitle: string;
  currentRating: number | null;
}

export function RateRecipeSheet({
  recipeId,
  recipeTitle,
  currentRating,
}: RateRecipeSheetProps) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    if (rating == null) return;
    startTransition(async () => {
      await rateRecipe(recipeId, rating, notes);
      setOpen(false);
      setRating(null);
      setNotes("");
    });
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setRating(null);
      setNotes("");
    }
    setOpen(next);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-0.5 cursor-pointer"
          aria-label="Rate this recipe"
        >
          <StarRating value={currentRating} readonly size="sm" />
        </button>
      </SheetTrigger>

      <SheetContent className="px-4 pb-8 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-sm sm:rounded-2xl">
        <SheetHeader className="mb-6">
          <SheetTitle>Rate this recipe</SheetTitle>
          <p className="text-sm text-muted-foreground line-clamp-1">
            {recipeTitle}
          </p>
        </SheetHeader>

        <div className="space-y-6">
          <div className="flex flex-col items-center gap-3">
            <StarRating value={rating} onChange={setRating} size="lg" />
            <p className="text-sm text-muted-foreground h-5">
              {rating != null ? `${rating / 2} / 5` : "Tap to rate"}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Notes (optional)</label>
            <Textarea
              placeholder="Any thoughts? What worked well, what would you change…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={rating == null || isPending}
          >
            {isPending ? "Saving…" : "Save rating"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
