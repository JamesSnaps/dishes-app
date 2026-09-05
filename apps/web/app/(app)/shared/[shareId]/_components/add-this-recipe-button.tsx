"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, Loader2 } from "lucide-react";
import { Button } from "@dishes/ui";
import { importRecipesFromLibrary } from "@/app/actions/library-shares";

/** Takes a single copy of one recipe from a shared library. */
export function AddThisRecipeButton({
  shareId,
  recipeId,
}: {
  shareId: string;
  recipeId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ recipeId: string; wasDuplicate: boolean } | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const { result, error: err } = await importRecipesFromLibrary(shareId, [recipeId]);
      if (err || !result) {
        setError(err ?? "Couldn't add that recipe.");
        return;
      }
      const first = result.results[0];
      if (!first || first.status === "failed") {
        setError(first?.status === "failed" ? first.reason : "Couldn't add that recipe.");
        return;
      }
      setDone({
        recipeId: "recipeId" in first ? first.recipeId : recipeId,
        wasDuplicate: first.status === "duplicate",
      });
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="text-right">
        <Button
          variant="secondary"
          className="gap-2"
          onClick={() => router.push(`/recipes/${done.recipeId}`)}
        >
          <Check className="h-4 w-4 text-emerald-600" />
          {done.wasDuplicate ? "Already yours — open it" : "Added — open it"}
        </Button>
      </div>
    );
  }

  return (
    <div className="text-right">
      <Button className="gap-2" onClick={add} disabled={isPending}>
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        Add to my recipes
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
