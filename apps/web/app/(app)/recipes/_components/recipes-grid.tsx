"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { CheckSquare2, Minus, Plus, Sparkles, Tag, X } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from "@dishes/ui";
import { RecipeCard } from "./recipe-card";
import { bulkAddTags, bulkRemoveTags } from "@/app/actions/recipes";

type Recipe = {
  id: string;
  title: string;
  description: string | null;
  cuisine: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  imageUrl: string | null;
  thumbnailUrl?: string | null;
  isFavourite: boolean;
  isAiGenerated: boolean;
  averageRating?: number | null;
  cookCount?: number;
};

// ─── Suggestion builder ───────────────────────────────────────────────────────

const TITLE_STOPWORDS = new Set([
  "the", "and", "with", "for", "from", "this", "that", "easy", "quick",
  "simple", "style", "homemade", "roasted", "baked", "fried", "grilled",
  "slow", "fresh", "into", "over", "your", "made", "make", "best", "good",
  "nice", "great", "using", "some", "like", "have", "just",
]);

function buildSuggestions(
  selectedRecipes: Recipe[],
  allTags: string[],
  pickedTags: Set<string>
): string[] {
  const candidates = new Set<string>();

  for (const r of selectedRecipes) {
    if (r.cuisine) candidates.add(r.cuisine.toLowerCase().trim());
    r.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !TITLE_STOPWORDS.has(w))
      .forEach((w) => candidates.add(w));
  }

  return Array.from(candidates)
    .filter((s) => !pickedTags.has(s))
    .sort((a, b) => {
      // Existing household tags bubble to the top
      const aExists = allTags.includes(a) ? 0 : 1;
      const bExists = allTags.includes(b) ? 0 : 1;
      return aExists - bExists || a.localeCompare(b);
    })
    .slice(0, 10);
}

// ─── Bulk tag dialog ──────────────────────────────────────────────────────────

interface BulkTagDialogProps {
  mode: "add" | "remove";
  allTags: string[];
  selectedRecipes: Recipe[];
  selectedCount: number;
  onConfirm: (tags: string[]) => void;
  onClose: () => void;
  pending: boolean;
}

function BulkTagDialog({
  mode,
  allTags,
  selectedRecipes,
  selectedCount,
  onConfirm,
  onClose,
  pending,
}: BulkTagDialogProps) {
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const normalizedSearch = search.trim().toLowerCase();

  const suggestions = useMemo(
    () =>
      mode === "add"
        ? buildSuggestions(selectedRecipes, allTags, pickedTags)
        : [],
    [mode, selectedRecipes, allTags, pickedTags]
  );

  const availableTags = allTags.filter((t) => !pickedTags.has(t));

  const filteredTags = normalizedSearch
    ? availableTags.filter((t) => t.includes(normalizedSearch))
    : availableTags;

  // Show "Create" option when search text doesn't exactly match any existing tag
  const showCreate =
    mode === "add" &&
    normalizedSearch.length > 0 &&
    !allTags.some((t) => t === normalizedSearch) &&
    !pickedTags.has(normalizedSearch);

  function addTag(tag: string) {
    const t = tag.trim().toLowerCase();
    if (!t) return;
    setPickedTags((prev) => new Set(prev).add(t));
    setSearch("");
    inputRef.current?.focus();
  }

  function removePickedTag(tag: string) {
    setPickedTags((prev) => {
      const next = new Set(prev);
      next.delete(tag);
      return next;
    });
  }

  const pickedArray = Array.from(pickedTags);
  const noun = selectedCount === 1 ? "recipe" : "recipes";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Add tags" : "Remove tags"} —{" "}
            <span className="text-muted-foreground font-normal">
              {selectedCount} {noun}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Selected pills */}
          {pickedArray.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pickedArray.map((tag) => (
                <Badge key={tag} className="gap-1 pl-2.5 pr-1">
                  {tag}
                  <button
                    type="button"
                    onClick={() => removePickedTag(tag)}
                    className="rounded-sm opacity-60 hover:opacity-100 transition-opacity ml-0.5"
                    aria-label={`Remove ${tag}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* Search / create input */}
          <Input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              mode === "add" ? "Search or create a tag…" : "Search tags…"
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Prefer exact match, then single filter result, then create new
                if (filteredTags[0] && filteredTags.length === 1) {
                  addTag(filteredTags[0]);
                } else if (showCreate) {
                  addTag(normalizedSearch);
                }
              }
              if (e.key === "Escape") {
                e.preventDefault();
                if (search) setSearch("");
                else onClose();
              }
            }}
            autoFocus
          />

          {/* Scrollable tag area */}
          <div className="max-h-52 overflow-y-auto space-y-3 -mx-1 px-1">
            {normalizedSearch === "" ? (
              <>
                {/* Smart suggestions (add mode only) */}
                {mode === "add" && suggestions.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      <Sparkles className="h-3 w-3" />
                      Suggested
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => addTag(tag)}
                          className={cn(
                            "rounded-full border border-dashed border-primary/50 bg-primary/5",
                            "px-3 py-1 text-xs font-medium text-primary",
                            "transition-colors hover:bg-primary/10 hover:border-primary"
                          )}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* All existing tags */}
                {availableTags.length > 0 && (
                  <div>
                    {mode === "add" && suggestions.length > 0 && (
                      <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        All tags
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {availableTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => addTag(tag)}
                          className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium transition-colors hover:bg-muted"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty states */}
                {availableTags.length === 0 && mode === "remove" && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No tags to remove.
                  </p>
                )}
                {availableTags.length === 0 &&
                  suggestions.length === 0 &&
                  mode === "add" && (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      Type above to create your first tag.
                    </p>
                  )}
              </>
            ) : (
              <>
                {/* Filtered matches */}
                {filteredTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {filteredTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => addTag(tag)}
                        className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium transition-colors hover:bg-muted"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}

                {/* Create new tag */}
                {showCreate && (
                  <button
                    type="button"
                    onClick={() => addTag(normalizedSearch)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm",
                      "border border-dashed border-border text-muted-foreground",
                      "transition-colors hover:border-primary hover:text-primary"
                    )}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    Create &ldquo;{normalizedSearch}&rdquo;
                  </button>
                )}

                {/* No matches and no create (remove mode) */}
                {filteredTags.length === 0 && !showCreate && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No matching tags.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(pickedArray)}
            disabled={pending || pickedTags.size === 0}
          >
            {pending
              ? "Saving…"
              : pickedTags.size === 0
              ? mode === "add"
                ? "Add tags"
                : "Remove tags"
              : mode === "add"
              ? `Add ${pickedTags.size} tag${pickedTags.size !== 1 ? "s" : ""} to ${selectedCount} ${noun}`
              : `Remove ${pickedTags.size} tag${pickedTags.size !== 1 ? "s" : ""} from ${selectedCount} ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main grid ────────────────────────────────────────────────────────────────

interface RecipesGridProps {
  recipes: Recipe[];
  allTags: string[];
}

export function RecipesGrid({ recipes, allTags }: RecipesGridProps) {
  const searchParams = useSearchParams();
  const backSearch = searchParams.toString();

  // Restore scroll position when returning from a recipe detail page
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("recipes-list-state");
      if (!raw) return;
      const { search, scrollY } = JSON.parse(raw) as { search: string; scrollY: number };
      if (search === backSearch && scrollY > 0) {
        window.scrollTo({ top: scrollY, behavior: "instant" });
      }
      sessionStorage.removeItem("recipes-list-state");
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dialogMode, setDialogMode] = useState<"add" | "remove" | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(recipes.map((r) => r.id)));
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function handleConfirmTags(tags: string[]) {
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      if (dialogMode === "add") await bulkAddTags(ids, tags);
      else if (dialogMode === "remove") await bulkRemoveTags(ids, tags);
      setDialogMode(null);
      exitSelectionMode();
    });
  }

  const selectedCount = selectedIds.size;
  const allSelected = recipes.length > 0 && selectedCount === recipes.length;
  const selectedRecipes = recipes.filter((r) => selectedIds.has(r.id));

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-end gap-2">
        {selectionMode ? (
          <>
            <span className="text-sm text-muted-foreground mr-auto">
              {selectedCount} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={allSelected ? () => setSelectedIds(new Set()) : selectAll}
            >
              {allSelected ? "Deselect all" : "Select all"}
            </Button>
            <Button variant="outline" size="sm" onClick={exitSelectionMode}>
              <X className="mr-1.5 h-4 w-4" />
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectionMode(true)}
          >
            <CheckSquare2 className="mr-1.5 h-4 w-4" />
            Select
          </Button>
        )}
      </div>

      {/* Recipe grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            {...recipe}
            selectable={selectionMode}
            selected={selectedIds.has(recipe.id)}
            onToggle={toggleSelection}
            backSearch={selectionMode ? undefined : backSearch}
          />
        ))}
      </div>

      {/* Floating bulk action bar */}
      {selectionMode && selectedCount > 0 && (
        <div className="fixed bottom-16 lg:bottom-4 left-4 right-4 z-50 flex items-center gap-3 rounded-2xl bg-foreground text-background px-4 py-3 shadow-xl">
          <span className="text-sm font-semibold mr-auto">
            {selectedCount} {selectedCount === 1 ? "recipe" : "recipes"}
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="bg-white/15 text-background border-white/20 hover:bg-white/25"
            onClick={() => setDialogMode("remove")}
          >
            <Minus className="mr-1.5 h-4 w-4" />
            Remove tags
          </Button>
          <Button
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setDialogMode("add")}
          >
            <Tag className="mr-1.5 h-4 w-4" />
            Add tags
          </Button>
        </div>
      )}

      {/* Tag dialog */}
      {dialogMode && (
        <BulkTagDialog
          mode={dialogMode}
          allTags={allTags}
          selectedRecipes={selectedRecipes}
          selectedCount={selectedCount}
          onConfirm={handleConfirmTags}
          onClose={() => setDialogMode(null)}
          pending={pending}
        />
      )}
    </div>
  );
}
