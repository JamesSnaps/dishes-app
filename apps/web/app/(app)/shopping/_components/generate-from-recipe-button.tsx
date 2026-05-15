"use client";

import { useState, useTransition } from "react";
import { ChefHat, Search, ArrowLeft, Package, Info } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  Input,
  Label,
} from "@dishes/ui";
import {
  generateFromRecipe,
  previewShoppingGeneration,
  type ShoppingPreview,
} from "@/app/actions/shopping";

interface Recipe {
  id: string;
  title: string;
  cuisine: string | null;
  servings: string | null;
  servingsUnit: string | null;
}

interface Props {
  recipes: Recipe[];
}

function formatAmt(amount: string | null, unit: string | null): string {
  if (!amount && !unit) return "";
  const parts: string[] = [];
  if (amount) {
    const n = parseFloat(amount);
    parts.push(isNaN(n) ? amount : (n % 1 === 0 ? String(n) : parseFloat(n.toFixed(2)).toString()));
  }
  if (unit) parts.push(unit);
  return parts.join(" ");
}

export function GenerateFromRecipeButton({ recipes }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [servings, setServings] = useState("");
  const [preview, setPreview] = useState<ShoppingPreview | null>(null);
  // Names that the user has checked to force-include despite being skipped
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const filtered = query.trim()
    ? recipes.filter((r) => r.title.toLowerCase().includes(query.toLowerCase()))
    : recipes;

  function handlePick(recipe: Recipe) {
    setSelected(recipe);
    setServings(recipe.servings ? String(parseFloat(recipe.servings)) : "");
  }

  function handleBack() {
    if (preview) {
      setPreview(null);
      setOverrides(new Set());
    } else {
      setSelected(null);
      setServings("");
    }
  }

  function handlePreview() {
    if (!selected) return;
    const parsed = parseFloat(servings);
    startTransition(async () => {
      const result = await previewShoppingGeneration(
        selected.id,
        isNaN(parsed) ? undefined : parsed
      );
      // If nothing is being skipped, skip the review step entirely
      if (result.skipped.length === 0) {
        await generateFromRecipe(selected.id, isNaN(parsed) ? undefined : parsed);
        resetAndClose();
      } else {
        setPreview(result);
        setOverrides(new Set());
      }
    });
  }

  function toggleOverride(name: string) {
    setOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function handleConfirm() {
    if (!selected || !preview) return;
    const parsed = parseFloat(servings);
    startTransition(async () => {
      await generateFromRecipe(
        selected.id,
        isNaN(parsed) ? undefined : parsed,
        overrides.size > 0 ? [...overrides] : undefined
      );
      resetAndClose();
    });
  }

  function resetAndClose() {
    setOpen(false);
    setSelected(null);
    setQuery("");
    setServings("");
    setPreview(null);
    setOverrides(new Set());
  }

  function handleOpenChange(val: boolean) {
    if (!val) resetAndClose();
    setOpen(val);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ChefHat className="mr-1.5 h-4 w-4" />
          Add from recipe
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">

        {/* ── Step 3: Review skipped items ─────────────────────────── */}
        {preview ? (
          <>
            <DialogHeader>
              <DialogTitle>Review pantry skips</DialogTitle>
            </DialogHeader>

            <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                These ingredients were skipped based on your pantry. Check any you want to add anyway.
              </p>
            </div>

            <ul className="divide-y rounded-lg border max-h-56 overflow-y-auto">
              {preview.skipped.map((item) => {
                const checked = overrides.has(item.ingredientName);
                const amt = formatAmt(item.amount, item.unit);
                return (
                  <li key={item.ingredientName}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOverride(item.ingredientName)}
                        className="h-4 w-4 rounded border-gray-300 accent-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm ${checked ? "text-foreground" : "text-muted-foreground line-through"}`}>
                          {amt && <span className="font-medium">{amt} </span>}
                          {item.ingredientName}
                        </span>
                      </div>
                      <span className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
                        <Package className="h-3 w-3" />
                        {item.reason === "staple" ? "staple" : "in stock"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {preview.adding.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {preview.adding.length} ingredient{preview.adding.length !== 1 ? "s" : ""} will be added normally.
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button variant="ghost" size="sm" onClick={handleBack} disabled={pending}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleConfirm} disabled={pending}>
                {pending ? "Adding…" : "Add to list"}
              </Button>
            </DialogFooter>
          </>

        /* ── Step 2: Servings ────────────────────────────────────── */
        ) : selected ? (
          <>
            <DialogHeader>
              <DialogTitle>How many servings?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{selected.title}</p>
            <div className="flex items-center gap-3">
              <Input
                id="servings-input"
                type="number"
                min="0.5"
                step="0.5"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                className="w-24"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handlePreview()}
              />
              <Label htmlFor="servings-input" className="text-sm text-muted-foreground">
                {selected.servingsUnit || "servings"}
              </Label>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" size="sm" onClick={handleBack} disabled={pending}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <Button onClick={handlePreview} disabled={pending}>
                {pending ? "Checking pantry…" : "Next"}
              </Button>
            </DialogFooter>
          </>

        /* ── Step 1: Pick recipe ─────────────────────────────────── */
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add ingredients from recipe</DialogTitle>
            </DialogHeader>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search recipes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
                autoFocus
              />
            </div>
            <ul className="max-h-72 overflow-y-auto divide-y">
              {filtered.length === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  No recipes found
                </li>
              )}
              {filtered.map((recipe) => (
                <li key={recipe.id}>
                  <button
                    onClick={() => handlePick(recipe)}
                    disabled={pending}
                    className="w-full px-2 py-3 text-left hover:bg-accent transition-colors rounded disabled:opacity-50"
                  >
                    <span className="font-medium">{recipe.title}</span>
                    {recipe.cuisine && (
                      <span className="ml-2 text-sm text-muted-foreground">
                        {recipe.cuisine}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
