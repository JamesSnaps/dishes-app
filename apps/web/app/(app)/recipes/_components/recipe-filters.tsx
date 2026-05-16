"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useCallback } from "react";
import { Heart, Search, SlidersHorizontal, X } from "lucide-react";
import { Input, Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@dishes/ui";

const TIME_OPTIONS = [
  { label: "Any", value: "" },
  { label: "≤ 30 min", value: "30" },
  { label: "≤ 1 hr", value: "60" },
  { label: "≤ 2 hrs", value: "120" },
];

const DIFFICULTY_OPTIONS = [
  { label: "Any", value: "" },
  { label: "Easy", value: "easy" },
  { label: "Medium", value: "medium" },
  { label: "Hard", value: "hard" },
];

function pill(active: boolean) {
  return `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
    active
      ? "bg-primary text-primary-foreground"
      : "bg-muted text-muted-foreground hover:bg-muted/70"
  }`;
}

function sheetPill(active: boolean) {
  return `rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "bg-primary text-primary-foreground"
      : "bg-muted text-muted-foreground hover:bg-muted/80"
  }`;
}

interface PillGroupProps {
  options: { label: string; value: string }[];
  current: string;
  onSelect: (v: string) => void;
  className?: string;
}

function PillGroup({ options, current, onSelect, className }: PillGroupProps) {
  return (
    <div className={`flex flex-wrap gap-1 ${className ?? ""}`}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onSelect(o.value)} className={pill(o.value === current)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface Props {
  cuisines: string[];
  tags: string[];
}

export function RecipeFilters({ cuisines, tags }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const cuisine = params.get("cuisine") ?? "";
  const favourites = params.get("favourites") ?? "";
  const difficulty = params.get("difficulty") ?? "";
  const maxTime = params.get("maxTime") ?? "";
  const activeTags = (params.get("tags") ?? "").split(",").filter(Boolean);

  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const next = new URLSearchParams(params.toString());
        if (value) next.set("q", value);
        else next.delete("q");
        router.push(`/recipes?${next.toString()}`);
      }, 300);
    },
    [params, router],
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingCuisine, setPendingCuisine] = useState(cuisine);
  const [pendingFavourites, setPendingFavourites] = useState(favourites === "1");
  const [pendingDifficulty, setPendingDifficulty] = useState(difficulty);
  const [pendingMaxTime, setPendingMaxTime] = useState(maxTime);
  const [pendingTags, setPendingTags] = useState<string[]>(activeTags);

  function push(updates: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.push(`/recipes?${next.toString()}`);
  }

  function openSheet() {
    setPendingCuisine(cuisine);
    setPendingFavourites(favourites === "1");
    setPendingDifficulty(difficulty);
    setPendingMaxTime(maxTime);
    setPendingTags(activeTags);
    setSheetOpen(true);
  }

  function applyFilters() {
    const next = new URLSearchParams();
    const currentQ = searchRef.current?.value.trim() ?? q;
    if (currentQ) next.set("q", currentQ);
    if (pendingCuisine) next.set("cuisine", pendingCuisine);
    if (pendingFavourites) next.set("favourites", "1");
    if (pendingDifficulty) next.set("difficulty", pendingDifficulty);
    if (pendingMaxTime) next.set("maxTime", pendingMaxTime);
    if (pendingTags.length > 0) next.set("tags", pendingTags.join(","));
    setSheetOpen(false);
    router.push(`/recipes?${next.toString()}`);
  }

  function clearPending() {
    setPendingCuisine("");
    setPendingFavourites(false);
    setPendingDifficulty("");
    setPendingMaxTime("");
    setPendingTags([]);
  }

  function togglePendingTag(tag: string) {
    setPendingTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function toggleTagUrl(tag: string) {
    const next = activeTags.includes(tag)
      ? activeTags.filter((t) => t !== tag)
      : [...activeTags, tag];
    push({ tags: next.join(",") });
  }

  function removeTagUrl(tag: string) {
    push({ tags: activeTags.filter((t) => t !== tag).join(",") });
  }

  const activeFilterCount =
    (cuisine ? 1 : 0) +
    (favourites === "1" ? 1 : 0) +
    (difficulty ? 1 : 0) +
    (maxTime ? 1 : 0) +
    activeTags.length;

  const pendingFilterCount =
    (pendingCuisine ? 1 : 0) +
    (pendingFavourites ? 1 : 0) +
    (pendingDifficulty ? 1 : 0) +
    (pendingMaxTime ? 1 : 0) +
    pendingTags.length;

  const hasActiveFilters = !!(q || cuisine || favourites || difficulty || maxTime || activeTags.length);

  return (
    <div className="mb-6 space-y-3">
      {/* Search row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchRef}
            defaultValue={q}
            placeholder="Search recipes…"
            className="pl-9 bg-muted border-0 focus-visible:ring-1"
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                push({ q: (e.target as HTMLInputElement).value });
              }
            }}
          />
        </div>

        {/* Mobile-only filter sheet trigger */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              onClick={openSheet}
              className={`lg:hidden relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                activeFilterCount > 0
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input bg-muted text-muted-foreground hover:text-foreground"
              }`}
              aria-label="Filter recipes"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </SheetTrigger>

          <SheetContent className="pb-safe overflow-y-auto">
            <SheetHeader>
              <div className="flex items-center justify-between pr-8">
                <SheetTitle>Filter Recipes</SheetTitle>
                {pendingFilterCount > 0 && (
                  <button
                    onClick={clearPending}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                    Clear all
                  </button>
                )}
              </div>
            </SheetHeader>

            <div className="space-y-5 p-4">
              {/* Favourites */}
              <div>
                <p className="mb-2.5 text-sm font-medium">Show</p>
                <label className="flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3">
                  <span className="text-sm">Favourites only</span>
                  <div
                    onClick={() => setPendingFavourites((v) => !v)}
                    className={`relative h-6 w-11 rounded-full transition-colors ${pendingFavourites ? "bg-primary" : "bg-muted"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        pendingFavourites ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </div>
                </label>
              </div>

              {/* Difficulty */}
              <div>
                <p className="mb-2.5 text-sm font-medium">Difficulty</p>
                <div className="flex flex-wrap gap-2">
                  {DIFFICULTY_OPTIONS.slice(1).map((o) => (
                    <button
                      key={o.value}
                      onClick={() => setPendingDifficulty(pendingDifficulty === o.value ? "" : o.value)}
                      className={sheetPill(pendingDifficulty === o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Total time */}
              <div>
                <p className="mb-2.5 text-sm font-medium">Total time</p>
                <div className="flex flex-wrap gap-2">
                  {TIME_OPTIONS.slice(1).map((o) => (
                    <button
                      key={o.value}
                      onClick={() => setPendingMaxTime(pendingMaxTime === o.value ? "" : o.value)}
                      className={sheetPill(pendingMaxTime === o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cuisine */}
              {cuisines.length > 0 && (
                <div>
                  <p className="mb-2.5 text-sm font-medium">Cuisine</p>
                  <div className="flex flex-wrap gap-2">
                    {cuisines.map((c) => (
                      <button
                        key={c}
                        onClick={() => setPendingCuisine(pendingCuisine === c ? "" : c)}
                        className={sheetPill(pendingCuisine === c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <div>
                  <p className="mb-2.5 text-sm font-medium">Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((t) => (
                      <button
                        key={t}
                        onClick={() => togglePendingTag(t)}
                        className={sheetPill(pendingTags.includes(t))}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={applyFilters}
                className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Show Recipes
              </button>
            </div>
          </SheetContent>
        </Sheet>

        {/* Mobile-only clear button */}
        {hasActiveFilters && (
          <button
            onClick={() => router.push("/recipes")}
            className="lg:hidden flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Desktop inline filter bar */}
      <div className="hidden lg:flex lg:flex-wrap lg:items-center lg:gap-x-1 lg:gap-y-2">
        {/* Favourites toggle */}
        <button
          onClick={() => push({ favourites: favourites === "1" ? "" : "1" })}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors mr-3 ${
            favourites === "1"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          <Heart className={`h-3 w-3 ${favourites === "1" ? "fill-current" : ""}`} />
          Favourites
        </button>

        <div className="h-4 w-px bg-border mx-2" />

        {/* Difficulty */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Difficulty</span>
          <PillGroup
            options={DIFFICULTY_OPTIONS}
            current={difficulty}
            onSelect={(v) => push({ difficulty: v })}
          />
        </div>

        <div className="h-4 w-px bg-border mx-2" />

        {/* Time */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Time</span>
          <PillGroup
            options={TIME_OPTIONS}
            current={maxTime}
            onSelect={(v) => push({ maxTime: v })}
          />
        </div>

        {/* Cuisine */}
        {cuisines.length > 0 && (
          <>
            <div className="h-4 w-px bg-border mx-2" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Cuisine</span>
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => push({ cuisine: "" })}
                  className={pill(!cuisine)}
                >
                  All
                </button>
                {cuisines.map((c) => (
                  <button
                    key={c}
                    onClick={() => push({ cuisine: cuisine === c ? "" : c })}
                    className={pill(cuisine === c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <>
            <div className="h-4 w-px bg-border mx-2" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Tags</span>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTagUrl(t)}
                    className={pill(activeTags.includes(t))}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Clear all */}
        {hasActiveFilters && (
          <>
            <div className="h-4 w-px bg-border mx-2" />
            <button
              onClick={() => router.push("/recipes")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear all
            </button>
          </>
        )}
      </div>

      {/* Mobile: active filter chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 lg:hidden">
          {cuisine && (
            <button
              onClick={() => push({ cuisine: "" })}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              {cuisine}
              <X className="h-3 w-3" />
            </button>
          )}
          {difficulty && (
            <button
              onClick={() => push({ difficulty: "" })}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              {difficulty}
              <X className="h-3 w-3" />
            </button>
          )}
          {maxTime && (
            <button
              onClick={() => push({ maxTime: "" })}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              ≤ {maxTime === "60" ? "1 hr" : maxTime === "120" ? "2 hrs" : `${maxTime} min`}
              <X className="h-3 w-3" />
            </button>
          )}
          {activeTags.map((t) => (
            <button
              key={t}
              onClick={() => removeTagUrl(t)}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              #{t}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
