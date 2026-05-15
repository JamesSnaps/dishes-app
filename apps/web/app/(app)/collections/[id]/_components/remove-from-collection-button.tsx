"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@dishes/ui";
import { removeRecipeFromCollection } from "@/app/actions/collections";

interface Props {
  collectionId: string;
  recipeId: string;
}

export function RemoveFromCollectionButton({ collectionId, recipeId }: Props) {
  const [pending, startTransition] = useTransition();

  function handleRemove() {
    startTransition(async () => {
      await removeRecipeFromCollection(collectionId, recipeId);
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive absolute top-2 right-2 bg-background/80 backdrop-blur-sm rounded-full"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        handleRemove();
      }}
      title="Remove from collection"
    >
      <X className="h-3.5 w-3.5" />
      <span className="sr-only">Remove from collection</span>
    </Button>
  );
}
