"use client";

import { useState, useTransition } from "react";
import { CheckSquare2, Minus, Tag, X } from "lucide-react";
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

// ─── Bulk tag dialog ──────────────────────────────────────────────────────────

interface BulkTagDialogProps {
  mode: "add" | "remove";
  allTags: string[];
  selectedCount: number;
  onConfirm: (tags: string[]) => void;
  onClose: () => void;
  pending: boolean;
}

function BulkTagDialog({
  mode,
  allTags,
  selectedCount,
  onConfirm,
  onClose,
  pending,
}: BulkTagDialogProps) {
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());
  const [inputValue, setInputValue] = useState("");

  function toggleTag(tag: string) {
    setPickedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function addInputTag() {
    const tag = inputValue.trim().toLowerCase();
    if (!tag) return;
    setPickedTags((prev) => new Set(prev).add(tag));
    setInputValue("");
  }

  const pickedArray = Array.from(pickedTags);
  const noun = selectedCount === 1 ? "recipe" : "recipes";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? "Add tags" : "Remove tags"} — {selectedCount} {noun}
          </DialogTitle>
        </DialogHeader>

        {/* Existing tag pills */}
        {allTags.length > 0 ? (
          <div className="flex flex-wrap gap-2 py-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-medium border transition-colors",
                  pickedTags.has(tag)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : (
          mode === "remove" && (
            <p className="text-sm text-muted-foreground py-2">No tags exist yet.</p>
          )
        )}

        {/* New tag input — add mode only */}
        {mode === "add" && (
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="New tag…"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addInputTag();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={addInputTag}
              disabled={!inputValue.trim()}
            >
              Add
            </Button>
          </div>
        )}

        {/* New tags not yet in allTags (add mode) */}
        {mode === "add" && pickedArray.some((t) => !allTags.includes(t)) && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-muted-foreground self-center">New:</span>
            {pickedArray
              .filter((t) => !allTags.includes(t))
              .map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                  {tag}
                  <button
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="rounded-sm hover:bg-muted-foreground/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
          </div>
        )}

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
              : mode === "add"
              ? `Add ${pickedTags.size > 0 ? `${pickedTags.size} tag${pickedTags.size !== 1 ? "s" : ""} to` : "tags to"} ${selectedCount} ${noun}`
              : `Remove ${pickedTags.size > 0 ? `${pickedTags.size} tag${pickedTags.size !== 1 ? "s" : ""} from` : "tags from"} ${selectedCount} ${noun}`}
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
          selectedCount={selectedCount}
          onConfirm={handleConfirmTags}
          onClose={() => setDialogMode(null)}
          pending={pending}
        />
      )}
    </div>
  );
}
