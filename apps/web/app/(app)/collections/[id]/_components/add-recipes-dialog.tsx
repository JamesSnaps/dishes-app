"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, Search, Check } from "lucide-react";
import Image from "next/image";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@dishes/ui";
import { addRecipeToCollection, searchRecipesForCollection } from "@/app/actions/collections";

interface Props {
  collectionId: string;
}

type RecipeResult = {
  id: string;
  title: string;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  alreadyAdded: boolean;
};

export function AddRecipesDialog({ collectionId }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecipeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setAdded(new Set());
      return;
    }
    // Load all recipes on open
    runSearch("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  function runSearch(q: string) {
    setLoading(true);
    searchRecipesForCollection(collectionId, q)
      .then((rows) => setResults(rows as RecipeResult[]))
      .finally(() => setLoading(false));
  }

  function handleAdd(recipeId: string) {
    startTransition(async () => {
      await addRecipeToCollection(collectionId, recipeId);
      setAdded((prev) => new Set(prev).add(recipeId));
      setResults((prev) =>
        prev.map((r) => (r.id === recipeId ? { ...r, alreadyAdded: true } : r))
      );
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" />
        Add recipes
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add recipes to collection</DialogTitle>
          </DialogHeader>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search recipes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

          {/* Results */}
          <div className="flex flex-col gap-0.5 max-h-80 overflow-y-auto -mx-1 px-1">
            {loading && results.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
            ) : results.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No recipes found.</p>
            ) : (
              results.map((recipe) => {
                const isAdded = added.has(recipe.id) || recipe.alreadyAdded;
                const thumb = recipe.thumbnailUrl ?? recipe.imageUrl;
                return (
                  <button
                    key={recipe.id}
                    disabled={isAdded || pending}
                    onClick={() => handleAdd(recipe.id)}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted transition-colors text-left disabled:cursor-default group"
                  >
                    <div className="h-9 w-9 rounded-md bg-muted shrink-0 overflow-hidden">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt=""
                          width={36}
                          height={36}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <span className="flex-1 truncate font-medium">{recipe.title}</span>
                    {isAdded ? (
                      <Check className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <Plus className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
