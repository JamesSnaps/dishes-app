"use client";

import { useState, useTransition } from "react";
import { ShoppingCart, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@dishes/ui";
import { generateFromRecipe } from "@/app/actions/shopping";

export function AddToShoppingButton({ recipeId }: { recipeId: string }) {
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await generateFromRecipe(recipeId);
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
          <Check className="h-4 w-4" />
          Added to list
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href="/shopping">View list</Link>
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={pending}
    >
      {pending ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <ShoppingCart className="mr-1.5 h-4 w-4" />
      )}
      {pending ? "Adding…" : "Add to shopping list"}
    </Button>
  );
}
