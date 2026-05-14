"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input, Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@dishes/ui";

interface Props {
  cuisines: string[];
}

export function RecipeFilters({ cuisines }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const cuisine = params.get("cuisine") ?? "";
  const favourites = params.get("favourites") ?? "";
  const searchRef = useRef<HTMLInputElement>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingCuisine, setPendingCuisine] = useState(cuisine);
  const [pendingFavourites, setPendingFavourites] = useState(favourites === "1");

  function push(updates: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`/recipes?${next.toString()}`);
  }

  function openSheet() {
    setPendingCuisine(cuisine);
    setPendingFavourites(favourites === "1");
    setSheetOpen(true);
  }

  function applyFilters() {
    const next = new URLSearchParams();
    const currentQ = searchRef.current?.value.trim() ?? q;
    if (currentQ) next.set("q", currentQ);
    if (pendingCuisine) next.set("cuisine", pendingCuisine);
    if (pendingFavourites) next.set("favourites", "1");
    setSheetOpen(false);
    router.push(`/recipes?${next.toString()}`);
  }

  const activeFilterCount = (cuisine ? 1 : 0) + (favourites === "1" ? 1 : 0);
  const hasActiveFilters = !!(q || cuisine || favourites);

  return (
    <div className="mb-6 space-y-3">
      {/* Search row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchRef}
            defaultValue={q}
            placeholder="Search recipes…"
            className="pl-9 bg-muted border-0 focus-visible:ring-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                push({ q: (e.target as HTMLInputElement).value });
              }
            }}
          />
        </div>

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              onClick={openSheet}
              className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                activeFilterCount > 0
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input bg-muted text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Filter recipes"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </SheetTrigger>

          <SheetContent className="pb-safe">
            <SheetHeader>
              <div className="flex items-center justify-between pr-8">
                <SheetTitle>Filter Recipes</SheetTitle>
                {(pendingCuisine || pendingFavourites) && (
                  <button
                    onClick={() => { setPendingCuisine(""); setPendingFavourites(false); }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                    Clear all
                  </button>
                )}
              </div>
            </SheetHeader>

            <div className="space-y-5 p-4">
              {/* Favourites */}
              <div>
                <p className="mb-2.5 text-sm font-medium">Show</p>
                <label className="flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3">
                  <span className="text-sm">Favourites only</span>
                  <div
                    onClick={() => setPendingFavourites((v) => !v)}
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      pendingFavourites ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        pendingFavourites ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </div>
                </label>
              </div>

              {/* Cuisine */}
              {cuisines.length > 0 && (
                <div>
                  <p className="mb-2.5 text-sm font-medium">Cuisine</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setPendingCuisine("")}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        !pendingCuisine
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      All
                    </button>
                    {cuisines.map((c) => (
                      <button
                        key={c}
                        onClick={() => setPendingCuisine(pendingCuisine === c ? "" : c)}
                        className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                          pendingCuisine === c
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={applyFilters}
                className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Show Recipes
              </button>
            </div>
          </SheetContent>
        </Sheet>

        {hasActiveFilters && (
          <button
            onClick={() => router.push("/recipes")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Active cuisine pill */}
      {cuisine && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Cuisine:</span>
          <button
            onClick={() => push({ cuisine: "" })}
            className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
          >
            {cuisine}
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
