"use client";

import { useState, useTransition, useDeferredValue } from "react";
import { Plus, Search } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@dishes/ui";
import { addMealEntry } from "@/app/actions/meal-plan";

type MealType = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";

const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "dessert", label: "Dessert" },
  { value: "snack", label: "Snack" },
];

interface Props {
  weekStartDate: string;
  dayOfWeek: number;
  dayLabel: string;
  recipes: { id: string; title: string; cuisine: string | null }[];
}

export function AddEntryDialog({
  weekStartDate,
  dayOfWeek,
  dayLabel,
  recipes,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mealType, setMealType] = useState<MealType>("dinner");
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search);

  const filtered = deferredSearch
    ? recipes.filter((r) =>
        r.title.toLowerCase().includes(deferredSearch.toLowerCase())
      )
    : recipes;

  function handleSelect(recipeId: string) {
    startTransition(async () => {
      await addMealEntry(weekStartDate, recipeId, dayOfWeek, mealType);
      setOpen(false);
      setSearch("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Plus className="mr-1.5 h-4 w-4" />
          Add meal
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add meal — {dayLabel}</DialogTitle>
        </DialogHeader>

        {/* Meal type selector */}
        <div className="flex gap-2 flex-wrap">
          {MEAL_TYPES.map((mt) => (
            <button
              key={mt.value}
              onClick={() => setMealType(mt.value)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                mealType === mt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              {mt.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search recipes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        {/* Recipe list */}
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No recipes found.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {filtered.map((recipe) => (
                <li key={recipe.id}>
                  <button
                    onClick={() => handleSelect(recipe.id)}
                    disabled={pending}
                    className="w-full text-left px-1 py-3 hover:bg-muted/50 transition-colors rounded"
                  >
                    <p className="font-medium leading-snug">{recipe.title}</p>
                    {recipe.cuisine && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {recipe.cuisine}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
