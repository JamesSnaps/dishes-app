"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { Search, X } from "lucide-react";
import { Button, Input } from "@dishes/ui";

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

  function push(updates: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`/recipes?${next.toString()}`);
  }

  const hasFilters = q || cuisine || favourites;

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            defaultValue={q}
            placeholder="Search recipes…"
            className="pl-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                push({ q: (e.target as HTMLInputElement).value });
              }
            }}
          />
        </div>

        <select
          value={cuisine}
          onChange={(e) => push({ cuisine: e.target.value })}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All cuisines</option>
          {cuisines.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={favourites === "1"}
            onChange={(e) => push({ favourites: e.target.checked ? "1" : "" })}
            className="h-4 w-4 rounded border-input"
          />
          Favourites only
        </label>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => router.push("/recipes")}
          >
            <X className="mr-1 h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      {/* Cuisine pills */}
      {cuisines.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => push({ cuisine: "" })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !cuisine
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            All
          </button>
          {cuisines.map((c) => (
            <button
              key={c}
              onClick={() => push({ cuisine: cuisine === c ? "" : c })}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                cuisine === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
