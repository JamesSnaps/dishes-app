"use client";

import { useState, useTransition, useDeferredValue, useMemo } from "react";
import {
  Plus,
  Search,
  Star,
  Heart,
  SlidersHorizontal,
  X,
  ChefHat,
  Clock,
} from "lucide-react";
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

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  hard: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

type Recipe = {
  id: string;
  title: string;
  cuisine: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  isFavourite: boolean;
  tags: string[];
  avgRating: number | null;
  ingredientNames: string[];
};

interface Props {
  weekStartDate: string;
  dayOfWeek: number;
  dayLabel: string;
  recipes: Recipe[];
  trigger?: React.ReactNode;
}

function StarRow({ rating, size = "sm" }: { rating: number; size?: "sm" | "xs" }) {
  const px = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${px} ${
            i <= Math.round(rating)
              ? "fill-amber-400 text-amber-400"
              : "fill-transparent text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

function formatTime(prep: number | null, cook: number | null) {
  const t = (prep ?? 0) + (cook ?? 0);
  if (t === 0) return null;
  return t < 60 ? `${t}m` : `${Math.floor(t / 60)}h${t % 60 > 0 ? ` ${t % 60}m` : ""}`;
}

// ── Reusable filter section label ────────────────────────────────────────────
function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
      {children}
    </p>
  );
}

export function AddEntryDialog({ weekStartDate, dayOfWeek, dayLabel, recipes, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [mealType, setMealType] = useState<MealType>("dinner");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | null>(null);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [pending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) for (const t of r.tags) set.add(t);
    return [...set].sort();
  }, [recipes]);

  const allCuisines = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) if (r.cuisine) set.add(r.cuisine);
    return [...set].sort();
  }, [recipes]);

  const filtered = useMemo(() => {
    let list = recipes;
    if (deferredSearch) {
      const q = deferredSearch.toLowerCase();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.cuisine ?? "").toLowerCase().includes(q) ||
          r.tags.some((t) => t.toLowerCase().includes(q)) ||
          r.ingredientNames.some((n) => n.toLowerCase().includes(q))
      );
    }
    if (selectedCuisines.length > 0)
      list = list.filter((r) => r.cuisine && selectedCuisines.includes(r.cuisine));
    if (selectedTags.length > 0)
      list = list.filter((r) => selectedTags.every((t) => r.tags.includes(t)));
    if (selectedDifficulty)
      list = list.filter((r) => r.difficulty === selectedDifficulty);
    if (minRating !== null)
      list = list.filter((r) => r.avgRating !== null && r.avgRating >= minRating);
    if (favouritesOnly)
      list = list.filter((r) => r.isFavourite);
    return list;
  }, [recipes, deferredSearch, selectedCuisines, selectedTags, selectedDifficulty, minRating, favouritesOnly]);

  const activeFilterCount =
    selectedTags.length +
    selectedCuisines.length +
    (selectedDifficulty ? 1 : 0) +
    (minRating !== null ? 1 : 0) +
    (favouritesOnly ? 1 : 0);

  function clearAllFilters() {
    setSelectedTags([]);
    setSelectedCuisines([]);
    setSelectedDifficulty(null);
    setMinRating(null);
    setFavouritesOnly(false);
  }

  function handleSelect(recipeId: string) {
    startTransition(async () => {
      await addMealEntry(weekStartDate, recipeId, dayOfWeek, mealType);
      setOpen(false);
      setSearch("");
      clearAllFilters();
    });
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }
  function toggleCuisine(cuisine: string) {
    setSelectedCuisines((prev) => prev.includes(cuisine) ? prev.filter((c) => c !== cuisine) : [...prev, cuisine]);
  }

  // ── Filter panel content (shared between mobile toggle and desktop sidebar) ──
  const filterPanelContent = (
    <div className="space-y-4">
      {allCuisines.length > 0 && (
        <div>
          <FilterLabel>Cuisine</FilterLabel>
          <div className="flex flex-wrap gap-1.5">
            {allCuisines.map((c) => (
              <button
                key={c}
                onClick={() => toggleCuisine(c)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-all border ${
                  selectedCuisines.includes(c)
                    ? "bg-indigo-500 text-white border-indigo-500"
                    : "bg-background border-border hover:border-indigo-300 text-muted-foreground hover:text-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {allTags.length > 0 && (
        <div>
          <FilterLabel>Tags</FilterLabel>
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((t) => (
              <button
                key={t}
                onClick={() => toggleTag(t)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-all border ${
                  selectedTags.includes(t)
                    ? "bg-violet-500 text-white border-violet-500"
                    : "bg-background border-border hover:border-violet-300 text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <FilterLabel>Difficulty</FilterLabel>
        <div className="flex gap-1.5 flex-wrap">
          {(["easy", "medium", "hard"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDifficulty((prev) => (prev === d ? null : d))}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all border ${
                selectedDifficulty === d
                  ? d === "easy"
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : d === "medium"
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-red-500 text-white border-red-500"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {DIFFICULTY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <FilterLabel>Min rating</FilterLabel>
        <div className="flex gap-1 flex-wrap">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setMinRating((prev) => (prev === n ? null : n))}
              className={`rounded-md px-1.5 py-0.5 text-xs font-medium transition-all border flex items-center gap-0.5 ${
                minRating === n
                  ? "bg-amber-400 text-white border-amber-400"
                  : minRating !== null && n < minRating
                    ? "bg-amber-50 border-amber-200 text-amber-600 dark:bg-amber-950/20"
                    : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Star className="h-2.5 w-2.5 fill-current" />
              {n}+
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => setFavouritesOnly((v) => !v)}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border transition-all ${
          favouritesOnly
            ? "bg-rose-500 text-white border-rose-500"
            : "bg-background border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        <Heart className={`h-3 w-3 ${favouritesOnly ? "fill-white" : ""}`} />
        Favourites
      </button>

      {activeFilterCount > 0 && (
        <button
          onClick={clearAllFilters}
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline block"
        >
          Clear all filters
        </button>
      )}
    </div>
  );

  // ── Recipe card ────────────────────────────────────────────────────────────
  const recipeGrid = (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {filtered.map((recipe) => {
        const thumb = recipe.thumbnailUrl ?? recipe.imageUrl;
        const time = formatTime(recipe.prepTimeMinutes, recipe.cookTimeMinutes);
        return (
          <button
            key={recipe.id}
            onClick={() => handleSelect(recipe.id)}
            disabled={pending}
            className="group flex flex-col rounded-xl border bg-card overflow-hidden text-left transition-all hover:shadow-md hover:border-primary/30 active:scale-[0.98] disabled:opacity-50"
          >
            <div className="relative w-full aspect-[4/3] bg-muted overflow-hidden">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb}
                  alt={recipe.title}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/60">
                  <span className="text-3xl opacity-30">🍽</span>
                </div>
              )}
              {recipe.isFavourite && (
                <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-rose-500/90 flex items-center justify-center shadow">
                  <Heart className="h-2.5 w-2.5 fill-white text-white" />
                </div>
              )}
              {recipe.difficulty && (
                <div className={`absolute bottom-1.5 left-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${DIFFICULTY_COLORS[recipe.difficulty]}`}>
                  {DIFFICULTY_LABELS[recipe.difficulty]}
                </div>
              )}
            </div>

            <div className="flex-1 px-2.5 py-2 flex flex-col gap-1">
              <p className="font-semibold text-sm leading-snug line-clamp-2">{recipe.title}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-auto">
                {recipe.avgRating !== null && <StarRow rating={recipe.avgRating} size="xs" />}
                {recipe.cuisine && (
                  <span className="text-[10px] text-muted-foreground truncate">{recipe.cuisine}</span>
                )}
                {time && (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground ml-auto shrink-0">
                    <Clock className="h-2.5 w-2.5" />
                    {time}
                  </span>
                )}
              </div>
              {recipe.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-0.5">
                  {recipe.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className={`rounded-full px-1.5 py-0 text-[9px] font-medium leading-4 ${
                        selectedTags.includes(tag)
                          ? "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {tag}
                    </span>
                  ))}
                  {recipe.tags.length > 3 && (
                    <span className="text-[9px] text-muted-foreground">+{recipe.tags.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="w-full gap-2 bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 text-white border-0 shadow-sm">
            <Plus className="h-4 w-4" />
            Add meal
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[92vh] flex flex-col gap-0 p-0 sm:max-w-4xl overflow-hidden">
        {/* ── Header ── */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="text-base">Add meal — {dayLabel}</DialogTitle>
        </DialogHeader>

        {/* ── Body: mobile=stacked, desktop=two-column ── */}
        <div className="flex-1 flex flex-col sm:flex-row overflow-hidden min-h-0">

          {/* ── Left sidebar ── */}
          <div className="shrink-0 sm:w-56 sm:border-r sm:flex sm:flex-col sm:overflow-hidden">

            {/* Meal type — horizontal pills on mobile, vertical list on desktop */}
            <div className="px-4 pt-3 pb-3 border-b shrink-0">
              <p className="hidden sm:block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Meal type
              </p>
              <div className="flex flex-wrap gap-1.5 sm:flex-col sm:gap-0.5">
                {MEAL_TYPES.map((mt) => (
                  <button
                    key={mt.value}
                    onClick={() => setMealType(mt.value)}
                    className={`text-xs font-semibold transition-all rounded-full px-3 py-1 sm:rounded-lg sm:px-3 sm:py-1.5 sm:text-left sm:w-full ${
                      mealType === mt.value
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {mt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile-only: search bar + filter toggle */}
            <div className="sm:hidden px-4 py-3 border-b shrink-0 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search recipes & ingredients…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                className={`flex items-center gap-1.5 px-3 h-9 w-full justify-center rounded-md border text-sm font-medium transition-all ${
                  filtersOpen || activeFilterCount > 0
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted text-muted-foreground"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-0.5 h-4 w-4 rounded-full bg-white/25 text-[10px] font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            {/* Filter panel:
                - Mobile: shown only when filtersOpen
                - Desktop: always shown, scrollable within sidebar */}
            <div className={`px-4 py-4 sm:flex-1 sm:overflow-y-auto ${filtersOpen ? "block" : "hidden sm:block"}`}>
              {filterPanelContent}
            </div>
          </div>

          {/* ── Right column: search (desktop) + count + scrollable grid ── */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

            {/* Desktop search */}
            <div className="hidden sm:block px-4 py-3 border-b shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search recipes & ingredients…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                  autoFocus
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Recipe count */}
            <div className="px-4 py-2 shrink-0">
              <p className="text-xs text-muted-foreground">
                {filtered.length === recipes.length
                  ? `${recipes.length} recipes`
                  : `${filtered.length} of ${recipes.length} recipes`}
              </p>
            </div>

            {/* Scrollable recipe grid */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {filtered.length === 0 ? (
                <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
                  <ChefHat className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No recipes match your filters.</p>
                  {activeFilterCount > 0 && (
                    <button onClick={clearAllFilters} className="text-xs text-primary hover:underline mt-1">
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                recipeGrid
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
