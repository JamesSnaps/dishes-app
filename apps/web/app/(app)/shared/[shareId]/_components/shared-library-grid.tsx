"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Download, Loader2, Search, X } from "lucide-react";
import { Button, Input } from "@dishes/ui";
import { RecipeCard } from "@/app/(app)/recipes/_components/recipe-card";
import { importRecipesFromLibrary } from "@/app/actions/library-shares";
import type { SharedRecipeSummary } from "@/lib/services/library-browse";

/**
 * Browsing someone else's library.
 *
 * Selection works like the recipes grid, but the only bulk action is "add to
 * my recipes" — you cannot tag or file another household's recipes, only take
 * a copy. Filtering is client-side: a shared library is a bounded list already
 * fetched in full, so there is nothing to gain from a round trip.
 */

interface Props {
  shareId: string;
  ownerName: string;
  recipes: SharedRecipeSummary[];
  cuisines: string[];
  tags: string[];
  /** Which recipes this household has already taken a copy of. */
  alreadyImported: Record<string, string>;
  canImport: boolean;
}

type Outcome = {
  imported: number;
  skipped: number;
  collectionName: string | null;
} | null;

export function SharedLibraryGrid({
  shareId,
  ownerName,
  recipes,
  cuisines,
  alreadyImported,
  canImport,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (cuisine && r.cuisine !== cuisine) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [recipes, query, cuisine]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function importSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;

    setError(null);
    startTransition(async () => {
      const { result, error: err } = await importRecipesFromLibrary(shareId, ids);
      if (err || !result) {
        setError(err ?? "Couldn't add those recipes.");
        return;
      }
      exitSelection();
      setOutcome({
        imported: result.imported,
        skipped: result.skipped,
        collectionName: result.collectionName,
      });
      router.refresh();
    });
  }

  const selectedCount = selectedIds.size;

  return (
    <div>
      {/* Result banner */}
      {outcome && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 p-3.5 shadow-sm">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
            <Check className="h-4 w-4" />
          </div>
          <div className="flex-1 text-sm leading-snug">
            <p className="font-semibold">
              {outcome.imported > 0
                ? `Added ${outcome.imported} recipe${outcome.imported === 1 ? "" : "s"}`
                : "Nothing new to add"}
            </p>
            <p className="text-muted-foreground">
              {outcome.collectionName ? (
                <>
                  Filed into{" "}
                  <Link href="/collections" className="font-medium text-primary underline underline-offset-2">
                    {outcome.collectionName}
                  </Link>
                  .{" "}
                </>
              ) : null}
              {outcome.skipped > 0 &&
                `${outcome.skipped} already in your library. `}
              Your copies are yours to edit — {ownerName} won&apos;t see changes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOutcome(null)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${ownerName}'s recipes…`}
            className="pl-9"
          />
        </div>

        {canImport &&
          (selectionMode ? (
            <Button variant="ghost" size="sm" onClick={exitSelection} disabled={isPending}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setSelectionMode(true)}>
              Select
            </Button>
          ))}
      </div>

      {cuisines.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCuisine(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              cuisine === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            All
          </button>
          {cuisines.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCuisine(cuisine === c ? null : c)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                cuisine === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {recipes.length === 0
            ? `${ownerName} isn't sharing any recipes right now.`
            : "No recipes match that search."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((recipe) => {
            const copyId = alreadyImported[recipe.id];
            return (
              <div key={recipe.id} className="relative">
                <RecipeCard
                  {...recipe}
                  isFavourite={false}
                  readOnly
                  href={`/shared/${shareId}/recipes/${recipe.id}`}
                  selectable={selectionMode}
                  selected={selectedIds.has(recipe.id)}
                  onToggle={toggle}
                />
                {copyId && !selectionMode && (
                  <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                    In your library
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk action bar */}
      {selectionMode && selectedCount > 0 && (
        <div className="fixed bottom-16 left-4 right-4 z-50 flex items-center gap-3 rounded-2xl bg-foreground px-4 py-3 text-background shadow-xl lg:bottom-4">
          <span className="text-sm font-medium">
            {selectedCount} selected
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto gap-2"
            onClick={importSelected}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Add to my recipes
          </Button>
        </div>
      )}
    </div>
  );
}
