"use client";

import { useState, useTransition } from "react";
import { ChefHat, Search } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@dishes/ui";
import { generateFromRecipe } from "@/app/actions/shopping";

interface Recipe {
  id: string;
  title: string;
  cuisine: string | null;
}

interface Props {
  recipes: Recipe[];
}

export function GenerateFromRecipeButton({ recipes }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const filtered = query.trim()
    ? recipes.filter((r) =>
        r.title.toLowerCase().includes(query.toLowerCase())
      )
    : recipes;

  function handlePick(recipeId: string) {
    startTransition(async () => {
      await generateFromRecipe(recipeId);
      setOpen(false);
      setQuery("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ChefHat className="mr-1.5 h-4 w-4" />
          Add from recipe
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
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
                onClick={() => handlePick(recipe.id)}
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
        {pending && (
          <p className="text-center text-sm text-muted-foreground">
            Adding ingredients…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
