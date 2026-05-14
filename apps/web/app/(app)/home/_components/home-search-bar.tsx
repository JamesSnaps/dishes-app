"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input, Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@dishes/ui";

interface Props {
  cuisines: string[];
}

export function HomeSearchBar({ cuisines }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedCuisine, setSelectedCuisine] = useState("");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const hasFilters = selectedCuisine || favouritesOnly;

  function onSearch(value: string) {
    const params = new URLSearchParams();
    if (value.trim()) params.set("q", value.trim());
    if (selectedCuisine) params.set("cuisine", selectedCuisine);
    if (favouritesOnly) params.set("favourites", "1");
    router.push(`/recipes?${params.toString()}`);
  }

  function applyFilters() {
    const params = new URLSearchParams();
    const q = inputRef.current?.value.trim();
    if (q) params.set("q", q);
    if (selectedCuisine) params.set("cuisine", selectedCuisine);
    if (favouritesOnly) params.set("favourites", "1");
    setSheetOpen(false);
    router.push(`/recipes?${params.toString()}`);
  }

  function clearFilters() {
    setSelectedCuisine("");
    setFavouritesOnly(false);
  }

  return (
    <div className="relative flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          placeholder="Search recipes, ingredients…"
          className="pl-9 pr-4 bg-muted border-0 focus-visible:ring-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSearch((e.target as HTMLInputElement).value);
            }
          }}
        />
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <button
            className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
              hasFilters
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-muted text-muted-foreground hover:text-foreground"
            }`}
            aria-label="Filter recipes"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {hasFilters && (
              <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                {(selectedCuisine ? 1 : 0) + (favouritesOnly ? 1 : 0)}
              </span>
            )}
          </button>
        </SheetTrigger>

        <SheetContent className="pb-safe">
          <SheetHeader>
            <div className="flex items-center justify-between pr-8">
              <SheetTitle>Filter Recipes</SheetTitle>
              {hasFilters && (
                <button
                  onClick={clearFilters}
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
                  onClick={() => setFavouritesOnly((v) => !v)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    favouritesOnly ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      favouritesOnly ? "translate-x-5" : "translate-x-0.5"
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
                    onClick={() => setSelectedCuisine("")}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      !selectedCuisine
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    All
                  </button>
                  {cuisines.map((c) => (
                    <button
                      key={c}
                      onClick={() => setSelectedCuisine(selectedCuisine === c ? "" : c)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        selectedCuisine === c
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

            {/* Apply button */}
            <button
              onClick={applyFilters}
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Show Recipes
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
