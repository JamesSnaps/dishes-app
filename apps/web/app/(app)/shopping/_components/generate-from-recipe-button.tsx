"use client";

import { useState, useTransition } from "react";
import { ChefHat, Search, ArrowLeft } from "lucide-react";
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
import { generateFromRecipe } from "@/app/actions/shopping";

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

export function GenerateFromRecipeButton({ recipes }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [servings, setServings] = useState("");
  const [pending, startTransition] = useTransition();

  const filtered = query.trim()
    ? recipes.filter((r) =>
        r.title.toLowerCase().includes(query.toLowerCase())
      )
    : recipes;

  function handlePick(recipe: Recipe) {
    setSelected(recipe);
    setServings(recipe.servings ? String(parseFloat(recipe.servings)) : "");
  }

  function handleBack() {
    setSelected(null);
    setServings("");
  }

  function handleConfirm() {
    if (!selected) return;
    const parsed = parseFloat(servings);
    startTransition(async () => {
      await generateFromRecipe(selected.id, isNaN(parsed) ? undefined : parsed);
      setOpen(false);
      setSelected(null);
      setQuery("");
      setServings("");
    });
  }

  function handleOpenChange(val: boolean) {
    if (!val) {
      setSelected(null);
      setQuery("");
      setServings("");
    }
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
        {selected ? (
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
                onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
              />
              <Label htmlFor="servings-input" className="text-sm text-muted-foreground">
                {selected.servingsUnit || "servings"}
              </Label>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleConfirm} disabled={pending}>
                Add to list
              </Button>
            </DialogFooter>
          </>
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
