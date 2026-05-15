"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
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
}

export function RateRecipeSheet({
  recipeId,
  recipeTitle,
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
        <Button variant="outline" size="sm" className="gap-1.5">
          <Star className="h-4 w-4" />
          Rate
        </Button>
      </SheetTrigger>

      <SheetContent className="px-4 pb-8">
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
              {rating != null ? `${rating} / 10` : "Tap to rate"}
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
