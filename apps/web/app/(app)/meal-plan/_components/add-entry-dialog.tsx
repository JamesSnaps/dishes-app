"use client";

import { useState, useTransition, useDeferredValue, useMemo, useEffect } from "react";
import {
  Plus,
  Search,
  Star,
  Heart,
  SlidersHorizontal,
  X,
  ChefHat,
  Clock,
  UtensilsCrossed,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { slotName } from "@/lib/saved-meals";
import type { SavedMeal } from "@/lib/services/meals";
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
import { MEAL_ROLES, MEAL_ROLE_LABELS, type MealRole } from "@dishes/shared";

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
  easy: "bg-success-tint text-success",
  medium: "bg-warning-tint text-warning",
  hard: "bg-destructive/10 text-destructive",
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
  mealRole?: string | null;
  /** Which meals this recipe suits. Empty means it has not been marked. */
  mealTypes?: string[] | null;
};

interface Props {
  weekStartDate: string;
  dayOfWeek: number;
  dayLabel: string;
  recipes: Recipe[];
  trigger?: React.ReactNode;
  /** Saved meals offered on a Meals tab. Omit (or empty) to hide the tab. */
  savedMeals?: SavedMeal[];
  /** Put a saved meal on the plan. Required for the Meals tab to show. */
  onAddSavedMeal?: (meal: SavedMeal, mealType: MealType) => void;
  /**
   * Picker mode: choosing a recipe calls `onPick` instead of adding it to the
   * plan — used to add a dish to a combined meal or swap one. Hides the meal
   * type and Meals tab; `preferredIds` are listed first.
   */
  pick?: {
    title: string;
    onPick: (recipeId: string) => void;
    preferredIds?: string[];
    /** Pre-select the dish-role filter, for example when adding a side. */
    role?: MealRole;
  };
  /** Controlled open state, for picker mode where there is no trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The slot it opens on, for the week grid's "+" in a particular row. */
  defaultMealType?: MealType;
  /**
   * How the entry is written. Defaults to the `addMealEntry` server action;
   * `WeekPlannerLocal` supplies a version that queues `meal_plan_entry.add` on
   * the sync engine, which is what makes adding work offline.
   */
  onAdd?: (
    weekStartDate: string,
    recipeId: string,
    dayOfWeek: number,
    mealType: MealType
  ) => void;
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
              ? "fill-primary text-primary"
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

export function AddEntryDialog({
  weekStartDate,
  dayOfWeek,
  dayLabel,
  recipes,
  trigger,
  onAdd,
  savedMeals = [],
  onAddSavedMeal,
  pick,
  open: openProp,
  defaultMealType,
  onOpenChange,
}: Props) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const showMealsTab = !pick && !!onAddSavedMeal;
  const [tab, setTab] = useState<"recipes" | "meals">("recipes");
  const [mealType, setMealType] = useState<MealType>("dinner");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | null>(null);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [matchMealType, setMatchMealType] = useState(true);
  const [roleFilter, setRoleFilter] = useState<MealRole | null>(pick?.role ?? null);
  useEffect(() => {
    if (open && defaultMealType) setMealType(defaultMealType);
  }, [open, defaultMealType]);
  const [pending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (open) setRoleFilter(pick?.role ?? null);
  }, [open, pick?.role]);

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
    if (!pick && matchMealType)
      list = list.filter((r) => (r.mealTypes ?? []).includes(mealType));
    if (roleFilter)
      list = list.filter((r) => r.mealRole === roleFilter);
    // Picker mode: likely candidates (recipes used in the same role before)
    // first, keeping alphabetical order within each half.
    const preferred = pick?.preferredIds;
    if (preferred?.length) {
      const rank = new Set(preferred);
      list = [...list].sort((a, b) => Number(rank.has(b.id)) - Number(rank.has(a.id)));
    }
    return list;
  }, [recipes, deferredSearch, selectedCuisines, selectedTags, selectedDifficulty, minRating, favouritesOnly, matchMealType, roleFilter, mealType, pick, pick?.preferredIds]);

  const filteredMeals = useMemo(() => {
    if (!deferredSearch) return savedMeals;
    const q = deferredSearch.toLowerCase();
    return savedMeals.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.slots.some((slot) => slot.options.some((o) => o.recipe.title.toLowerCase().includes(q)))
    );
  }, [savedMeals, deferredSearch]);

  const activeFilterCount =
    selectedTags.length +
    selectedCuisines.length +
    (selectedDifficulty ? 1 : 0) +
    (minRating !== null ? 1 : 0) +
    (favouritesOnly ? 1 : 0) +
    (!pick && matchMealType ? 1 : 0) +
    (roleFilter ? 1 : 0);

  function clearAllFilters() {
    setSelectedTags([]);
    setSelectedCuisines([]);
    setSelectedDifficulty(null);
    setMinRating(null);
    setFavouritesOnly(false);
    setMatchMealType(false);
    setRoleFilter(null);
  }

  function reset() {
    setOpen(false);
    setSearch("");
    setTab("recipes");
    clearAllFilters();
    setMatchMealType(true);
  }

  function handleSelectMeal(meal: SavedMeal) {
    onAddSavedMeal?.(meal, mealType);
    reset();
  }

  function handleSelect(recipeId: string) {
    if (pick) {
      pick.onPick(recipeId);
      reset();
      return;
    }

    if (onAdd) {
      // Queued locally and applied optimistically — no await, and no reason to
      // keep the dialog open waiting for a server that may not be reachable.
      onAdd(weekStartDate, recipeId, dayOfWeek, mealType);
      reset();
      return;
    }

    startTransition(async () => {
      await addMealEntry(weekStartDate, recipeId, dayOfWeek, mealType);
      reset();
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
                    ? "bg-ink text-ink-foreground border-transparent"
                    : "bg-background border-border hover:border-input text-muted-foreground hover:text-foreground"
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
                    ? "bg-ink text-ink-foreground border-transparent"
                    : "bg-background border-border hover:border-input text-muted-foreground hover:text-foreground"
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
                    ? "bg-success text-card border-transparent"
                    : d === "medium"
                      ? "bg-warning text-card border-transparent"
                      : "bg-destructive text-destructive-foreground border-transparent"
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
                  ? "bg-warning text-card border-transparent"
                  : minRating !== null && n < minRating
                    ? "bg-warning-tint border-border text-warning"
                    : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Star className="h-2.5 w-2.5 fill-current" />
              {n}+
            </button>
          ))}
        </div>
      </div>

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
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  <span className="text-3xl opacity-30">🍽</span>
                </div>
              )}
              {recipe.isFavourite && (
                <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-primary flex items-center justify-center shadow">
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
                          ? "bg-muted text-foreground"
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

  // ── Saved meal cards ───────────────────────────────────────────────────────
  const mealsGrid = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {filteredMeals.map((meal) => {
        const thumbs = meal.slots
          .map((slot) => slot.options[0]!.recipe)
          .map((r) => r.thumbnailUrl ?? r.imageUrl)
          .filter((u): u is string => !!u)
          .slice(0, 4);
        return (
          <button
            key={meal.id}
            onClick={() => handleSelectMeal(meal)}
            className="group flex gap-3 rounded-xl border border-border bg-highlight p-3 text-left shadow-sm transition-all hover:shadow-md hover:border-input active:scale-[0.99]"
          >
            <div className="grid grid-cols-2 gap-0.5 h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-highlight">
              {thumbs.length ? (
                thumbs.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt=""
                    className={`h-full w-full object-cover ${thumbs.length === 1 ? "col-span-2 row-span-2" : ""}`}
                  />
                ))
              ) : (
                <div className="col-span-2 row-span-2 flex items-center justify-center">
                  <UtensilsCrossed className="h-6 w-6 text-primary" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm leading-snug line-clamp-1">{meal.title}</p>
              <ul className="mt-1 space-y-0.5">
                {meal.slots.slice(0, 4).map((slot) => (
                  <li key={slot.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="shrink-0 rounded-full bg-card/70 dark:bg-black/20 px-1.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                      {slotName(slot)}
                    </span>
                    <span className="truncate">
                      {slot.options.map((o) => o.recipe.title).join(slot.allowMultiple ? ", " : " / ")}
                    </span>
                  </li>
                ))}
                {meal.slots.length > 4 && (
                  <li className="text-[11px] text-muted-foreground">+{meal.slots.length - 4} more</li>
                )}
              </ul>
            </div>
          </button>
        );
      })}
    </div>
  );

  const mealsEmpty = (
    <div className="py-12 flex flex-col items-center gap-2 text-center text-muted-foreground">
      <UtensilsCrossed className="h-8 w-8 opacity-30" />
      <p className="text-sm">
        {savedMeals.length === 0 ? "No saved meals yet." : "No saved meals match your search."}
      </p>
      {savedMeals.length === 0 && (
        <p className="text-xs max-w-xs">
          Combine dishes on the plan and choose “Save as a meal”, or build one from the Meals page.
        </p>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {(trigger !== undefined || openProp === undefined) && (
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" className="w-full gap-2 border-dashed text-primary">
            <Plus className="h-4 w-4" />
            Add meal
          </Button>
        )}
      </DialogTrigger>
      )}

      <DialogContent className="max-h-[92vh] flex flex-col gap-0 p-0 sm:max-w-4xl overflow-hidden">
        {/* ── Header ── */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="text-base">{pick ? pick.title : `Add meal — ${dayLabel}`}</DialogTitle>
          {showMealsTab && (
            <div className="flex items-center gap-2 pt-2">
              <div className="inline-flex rounded-lg bg-muted p-0.5">
                {(["recipes", "meals"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                      tab === t
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "recipes" ? "Recipes" : `Saved meals${savedMeals.length ? ` (${savedMeals.length})` : ""}`}
                  </button>
                ))}
              </div>
              {tab === "meals" && (
                <Link
                  href="/meals"
                  className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Manage
                </Link>
              )}
            </div>
          )}
        </DialogHeader>

        {/* ── Body: mobile=stacked, desktop=two-column ── */}
        <div className="flex-1 flex flex-col sm:flex-row overflow-hidden min-h-0">

          {/* ── Left sidebar ── */}
          <div className="shrink-0 sm:w-56 sm:border-r sm:flex sm:flex-col sm:overflow-hidden">

            {/* Meal type — horizontal pills on mobile, vertical list on desktop */}
            <div className={`px-4 pt-3 pb-3 border-b shrink-0 ${pick ? "hidden" : ""}`}>
              <p className="hidden sm:block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Add to this slot
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

            {/* Always-visible filters: meal match, favourites, dish role */}
            <div className={`px-4 py-3 border-b shrink-0 space-y-2.5 ${tab === "meals" ? "hidden" : ""}`}>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  aria-pressed={favouritesOnly}
                  onClick={() => setFavouritesOnly((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border shadow-sm transition-all ${
                    favouritesOnly
                      ? "bg-primary text-primary-foreground border-transparent"
                      : "bg-highlight border-border text-primary hover:bg-highlight"
                  }`}
                >
                  <Heart className={`h-3 w-3 ${favouritesOnly ? "fill-white" : "fill-primary text-primary"}`} />
                  Favourites
                </button>
                {!pick && (
                  <button
                    type="button"
                    aria-pressed={matchMealType}
                    onClick={() => setMatchMealType((v) => !v)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold border shadow-sm transition-all ${
                      matchMealType
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Suited to {MEAL_TYPES.find((mt) => mt.value === mealType)?.label.toLowerCase()}
                  </button>
                )}
              </div>
              <div>
                <FilterLabel>Kind of dish</FilterLabel>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    aria-pressed={roleFilter === null}
                    onClick={() => setRoleFilter(null)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border transition-all ${
                      roleFilter === null
                        ? "bg-primary text-primary-foreground border-transparent"
                        : "bg-background border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Any
                  </button>
                  {MEAL_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      aria-pressed={roleFilter === role}
                      onClick={() => setRoleFilter((prev) => (prev === role ? null : role))}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border transition-all ${
                        roleFilter === role
                          ? "bg-primary text-primary-foreground border-transparent"
                          : "bg-highlight border-border text-primary hover:bg-highlight"
                      }`}
                    >
                      {MEAL_ROLE_LABELS[role]}
                    </button>
                  ))}
                </div>
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
                className={`${tab === "meals" ? "hidden" : "flex"} items-center gap-1.5 px-3 h-9 w-full justify-center rounded-md border text-sm font-medium transition-all ${
                  filtersOpen || activeFilterCount > 0
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted text-muted-foreground"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-0.5 h-4 w-4 rounded-full bg-card/25 text-[10px] font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            {/* Filter panel:
                - Mobile: shown only when filtersOpen
                - Desktop: always shown, scrollable within sidebar */}
            <div className={`px-4 py-4 sm:flex-1 sm:overflow-y-auto ${tab === "meals" ? "hidden" : filtersOpen ? "block" : "hidden sm:block"}`}>
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
                {tab === "meals"
                  ? `${filteredMeals.length} saved meal${filteredMeals.length === 1 ? "" : "s"}`
                  : filtered.length === recipes.length
                    ? `${recipes.length} recipes`
                    : `${filtered.length} of ${recipes.length} recipes`}
              </p>
            </div>

            {/* Scrollable recipe grid */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {tab === "meals" ? (
                filteredMeals.length === 0 ? mealsEmpty : mealsGrid
              ) : filtered.length === 0 ? (
                <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
                  <ChefHat className="h-8 w-8 opacity-30" />
                  <p className="text-sm text-center px-6">
                    {matchMealType && !pick
                      ? `No recipes are marked as ${MEAL_TYPES.find((mt) => mt.value === mealType)?.label.toLowerCase()}.`
                      : "No recipes match your filters."}
                  </p>
                  {activeFilterCount > 0 && (
                    <button onClick={clearAllFilters} className="text-xs font-medium text-primary hover:underline mt-1">
                      Show every recipe
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
