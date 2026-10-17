"use client";

import { MEAL_ROLES, MEAL_ROLE_LABELS } from "@dishes/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { useSync, useSyncedCollection } from "@/components/providers/sync-provider";
import { useRef, useState, useCallback } from "react";
import {
  ArrowDownUp,
  Check,
  ChefHat,
  Layers,
  LayoutGrid,
  Clock,
  Globe2,
  Heart,
  HeartPulse,
  Search,
  SlidersHorizontal,
  Tag,
  X,
} from "lucide-react";
import { Input, Sheet, SheetContent, SheetHeader, SheetTitle } from "@dishes/ui";
import { useMediaQuery } from "@/hooks/use-media-query";
import { parseTags, type FacetOption } from "@/lib/recipe-filtering";

const SORT_OPTIONS = [
  { label: "Newest", value: "newest" },
  { label: "A–Z", value: "az" },
  { label: "Top rated", value: "rating" },
  { label: "Recently cooked", value: "cooked" },
];

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

const ROLE_OPTIONS = [
  { label: "All", value: "" },
  ...MEAL_ROLES.map((role) => ({ label: MEAL_ROLE_LABELS[role], value: role as string })),
];

const labelOf = (options: { label: string; value: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

/** One row of mutually exclusive options, shown as a segmented control. */
function Segmented({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-muted p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`rounded-lg px-2 py-1.5 text-sm font-medium transition-all ${
              on
                ? "bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-md"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** How many suggestions to show before the user has typed anything. */
const POPULAR_COUNT = 10;
/** Cap on matches while typing; the list scrolls, but hundreds is noise. */
const MATCH_LIMIT = 30;
/** Below this many options, just show them all with no search box. */
const SEARCH_THRESHOLD = 12;

/**
 * Pick one or more values from a long free-text list (cuisines, tags): what's
 * selected sits on top as removable chips, a box narrows the rest as you type,
 * and with nothing typed it offers the most used ones.
 */
function FacetPicker({
  options,
  selected,
  onToggle,
  placeholder,
  noun,
}: {
  options: FacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
  placeholder: string;
  noun: string;
}) {
  const [query, setQuery] = useState("");
  const isSelected = (v: string) => selected.some((s) => s.toLowerCase() === v.toLowerCase());

  const needle = query.trim().toLowerCase();
  const searchable = options.length > SEARCH_THRESHOLD;
  const rest = options.filter((o) => !isSelected(o.value));

  let suggestions: FacetOption[];
  if (!searchable) suggestions = rest;
  else if (!needle) suggestions = [...rest].sort((a, b) => b.count - a.count).slice(0, POPULAR_COUNT);
  else {
    const rank = (o: FacetOption) => (o.value.toLowerCase().startsWith(needle) ? 0 : 1);
    suggestions = rest
      .filter((o) => o.value.toLowerCase().includes(needle))
      .sort((a, b) => rank(a) - rank(b) || b.count - a.count)
      .slice(0, MATCH_LIMIT);
  }

  function pick(value: string) {
    onToggle(value);
    setQuery("");
  }

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              aria-label={`Remove ${v}`}
              className="flex items-center gap-1 rounded-full bg-gradient-to-br from-orange-500 to-rose-500 py-1 pl-3 pr-2 text-sm font-medium text-white shadow-sm"
            >
              {v}
              <X className="h-3.5 w-3.5 opacity-80" />
            </button>
          ))}
        </div>
      )}

      {searchable && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (needle && suggestions[0]) pick(suggestions[0].value);
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="h-9 border-0 bg-muted pl-9 text-sm focus-visible:ring-1"
          />
        </div>
      )}

      {searchable && !needle && suggestions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Most used · {options.length} {noun} in all — type to find the rest
        </p>
      )}

      <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
        {suggestions.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => pick(o.value)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
          >
            {o.value}
            <span className="text-xs tabular-nums text-muted-foreground">{o.count}</span>
          </button>
        ))}
        {needle && suggestions.length === 0 && (
          <p className="py-1 text-sm text-muted-foreground">No {noun} match &ldquo;{query.trim()}&rdquo;.</p>
        )}
      </div>
    </div>
  );
}

interface Props {
  cuisines: FacetOption[];
  tags: FacetOption[];
}

export function RecipeFilters({ cuisines, tags }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // When the list is being rendered from the local store, a filter change does
  // not need the server: push the URL with the History API instead of
  // router.push. Next syncs useSearchParams from it without fetching an RSC
  // payload, so the grid re-filters locally and the change is instant.
  //
  // Falls back to router.push whenever there is no local data — first visit, or
  // sync unavailable — so the server still does the filtering in that case.
  const sync = useSync();
  const { data: localRecipes } = useSyncedCollection("recipes");
  const canFilterLocally = Boolean(sync?.engine) && localRecipes.length > 0;

  const navigate = useCallback(
    (url: string) => {
      if (canFilterLocally) window.history.pushState(null, "", url);
      else router.push(url);
    },
    [canFilterLocally, router]
  );
  const q = params.get("q") ?? "";
  const cuisine = params.get("cuisine") ?? "";
  const favourites = params.get("favourites") ?? "";
  const heart = params.get("heart") ?? "";
  const recipeRole = params.get("role") ?? "";
  const difficulty = params.get("difficulty") ?? "";
  const maxTime = params.get("maxTime") ?? "";
  const activeTags = parseTags(params.get("tags"));
  const sort = params.get("sort") ?? "newest";
  // The whole library as a grid, chosen from browse mode (recipes-browse.tsx).
  const viewAll = params.get("view") === "all";

  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const next = new URLSearchParams(params.toString());
        if (value) next.set("q", value);
        else next.delete("q");
        navigate(`/recipes?${next.toString()}`);
      }, 300);
    },
    [params, navigate]
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingRole, setPendingRole] = useState(recipeRole);
  const [pendingCuisine, setPendingCuisine] = useState(cuisine);
  const [pendingFavourites, setPendingFavourites] = useState(favourites === "1");
  const [pendingHeart, setPendingHeart] = useState(heart === "1");
  const [pendingDifficulty, setPendingDifficulty] = useState(difficulty);
  const [pendingMaxTime, setPendingMaxTime] = useState(maxTime);
  const [pendingTags, setPendingTags] = useState<string[]>(activeTags);
  const [pendingSort, setPendingSort] = useState(sort);

  function push(updates: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    navigate(`/recipes?${next.toString()}`);
  }

  function openSheet() {
    setPendingRole(recipeRole);
    setPendingCuisine(cuisine);
    setPendingFavourites(favourites === "1");
    setPendingHeart(heart === "1");
    setPendingDifficulty(difficulty);
    setPendingMaxTime(maxTime);
    setPendingTags(activeTags);
    setPendingSort(sort);
    setSheetOpen(true);
  }

  function applyFilters() {
    const next = new URLSearchParams();
    if (pendingRole) next.set("role", pendingRole);
    const currentQ = searchRef.current?.value.trim() ?? q;
    if (currentQ) next.set("q", currentQ);
    if (pendingCuisine) next.set("cuisine", pendingCuisine);
    if (pendingFavourites) next.set("favourites", "1");
    if (pendingHeart) next.set("heart", "1");
    if (pendingDifficulty) next.set("difficulty", pendingDifficulty);
    if (pendingMaxTime) next.set("maxTime", pendingMaxTime);
    if (pendingTags.length > 0) next.set("tags", pendingTags.join(","));
    if (pendingSort && pendingSort !== "newest") next.set("sort", pendingSort);
    if (viewAll) next.set("view", "all");
    setSheetOpen(false);
    navigate(`/recipes?${next.toString()}`);
  }

  function clearPending() {
    setPendingRole("");
    setPendingCuisine("");
    setPendingFavourites(false);
    setPendingHeart(false);
    setPendingDifficulty("");
    setPendingMaxTime("");
    setPendingTags([]);
    setPendingSort("newest");
  }

  function togglePendingTag(tag: string) {
    setPendingTags((prev) =>
      prev.some((t) => t.toLowerCase() === tag.toLowerCase())
        ? prev.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...prev, tag]
    );
  }

  function clearAll() {
    if (searchRef.current) searchRef.current.value = "";
    navigate("/recipes");
  }

  const activeFilterCount =
    (recipeRole ? 1 : 0) +
    (cuisine ? 1 : 0) +
    (favourites === "1" ? 1 : 0) +
    (heart === "1" ? 1 : 0) +
    (difficulty ? 1 : 0) +
    (maxTime ? 1 : 0) +
    activeTags.length +
    (sort !== "newest" ? 1 : 0);

  const pendingFilterCount =
    (pendingRole ? 1 : 0) +
    (pendingCuisine ? 1 : 0) +
    (pendingFavourites ? 1 : 0) +
    (pendingHeart ? 1 : 0) +
    (pendingDifficulty ? 1 : 0) +
    (pendingMaxTime ? 1 : 0) +
    pendingTags.length +
    (pendingSort !== "newest" ? 1 : 0);

  const chip =
    "flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20";

  const toggleCard = (on: boolean, tone: "primary" | "rose") =>
    `flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all ${
      on
        ? tone === "rose"
          ? "border-transparent bg-gradient-to-br from-rose-500 to-pink-500 text-white shadow-md"
          : "border-transparent bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-md"
        : "border-border bg-muted/60 hover:bg-muted"
    }`;

  return (
    <div className="mb-6 space-y-3">
      {/* Search, with the filter panel's button tucked into its right edge */}
      <div className="relative max-w-3xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          defaultValue={q}
          placeholder="Search recipes or ingredients…"
          className="h-11 border-0 bg-muted pl-9 pr-20 focus-visible:ring-1 sm:pr-28"
          onChange={(e) => handleSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              push({ q: (e.target as HTMLInputElement).value });
            }
          }}
        />
        <button
          type="button"
          onClick={openSheet}
          aria-label={activeFilterCount ? `Filters (${activeFilterCount} on)` : "Filters"}
          className={`absolute right-1.5 top-1/2 flex h-8 -translate-y-1/2 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold shadow-sm transition-all ${
            activeFilterCount > 0
              ? "bg-gradient-to-br from-orange-500 to-rose-500 text-white"
              : "border border-border bg-background text-foreground hover:border-primary/50"
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/25 px-1 text-xs tabular-nums">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* What's on, each removable in one tap */}
      {(activeFilterCount > 0 || q || viewAll) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {viewAll && (
            <button type="button" onClick={() => push({ view: "" })} className={chip}>
              <LayoutGrid className="h-3 w-3" />
              All recipes
              <X className="h-3 w-3" />
            </button>
          )}
          {recipeRole && (
            <button type="button" onClick={() => push({ role: "" })} className={chip}>
              <Layers className="h-3 w-3" />
              {labelOf(ROLE_OPTIONS, recipeRole)}
              <X className="h-3 w-3" />
            </button>
          )}
          {sort !== "newest" && (
            <button type="button" onClick={() => push({ sort: "" })} className={chip}>
              <ArrowDownUp className="h-3 w-3" />
              {labelOf(SORT_OPTIONS, sort)}
              <X className="h-3 w-3" />
            </button>
          )}
          {favourites === "1" && (
            <button type="button" onClick={() => push({ favourites: "" })} className={chip}>
              <Heart className="h-3 w-3 fill-current" />
              Favourites
              <X className="h-3 w-3" />
            </button>
          )}
          {heart === "1" && (
            <button
              type="button"
              onClick={() => push({ heart: "" })}
              className="flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 py-1 pl-2.5 pr-2 text-xs font-medium text-rose-600 hover:bg-rose-500/20 dark:text-rose-400"
            >
              <HeartPulse className="h-3 w-3" />
              Heart-healthy
              <X className="h-3 w-3" />
            </button>
          )}
          {difficulty && (
            <button type="button" onClick={() => push({ difficulty: "" })} className={chip}>
              <ChefHat className="h-3 w-3" />
              {labelOf(DIFFICULTY_OPTIONS, difficulty)}
              <X className="h-3 w-3" />
            </button>
          )}
          {maxTime && (
            <button type="button" onClick={() => push({ maxTime: "" })} className={chip}>
              <Clock className="h-3 w-3" />
              {labelOf(TIME_OPTIONS, maxTime)}
              <X className="h-3 w-3" />
            </button>
          )}
          {cuisine && (
            <button type="button" onClick={() => push({ cuisine: "" })} className={chip}>
              <Globe2 className="h-3 w-3" />
              {cuisine}
              <X className="h-3 w-3" />
            </button>
          )}
          {activeTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => push({ tags: activeTags.filter((x) => x !== t).join(",") })}
              className={chip}
            >
              <Tag className="h-3 w-3" />
              {t}
              <X className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side={isDesktop ? "right" : "bottom"}
          className={`flex flex-col p-0 ${isDesktop ? "w-full max-w-md" : "max-h-[85dvh]"}`}
          aria-describedby={undefined}
        >
          <SheetHeader className="shrink-0 border-b px-4 py-3">
            <div className="flex items-center justify-between pr-8">
              <SheetTitle>Filter recipes</SheetTitle>
              {pendingFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearPending}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  Reset
                </button>
              )}
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-6 overflow-y-auto p-4">
            <Section icon={Layers} title="Role">
              <Segmented options={ROLE_OPTIONS} value={pendingRole} onChange={setPendingRole} />
            </Section>

            <Section icon={ArrowDownUp} title="Sort by">
              <Segmented options={SORT_OPTIONS} value={pendingSort} onChange={setPendingSort} />
            </Section>

            <Section icon={Heart} title="Show only">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={pendingFavourites}
                  onClick={() => setPendingFavourites((v) => !v)}
                  className={toggleCard(pendingFavourites, "primary")}
                >
                  <Heart className={`h-4 w-4 ${pendingFavourites ? "fill-current" : ""}`} />
                  Favourites
                  {pendingFavourites && <Check className="ml-auto h-4 w-4" />}
                </button>
                <button
                  type="button"
                  aria-pressed={pendingHeart}
                  onClick={() => setPendingHeart((v) => !v)}
                  className={toggleCard(pendingHeart, "rose")}
                >
                  <HeartPulse className={`h-4 w-4 ${pendingHeart ? "" : "text-rose-500"}`} />
                  Heart-healthy
                  {pendingHeart && <Check className="ml-auto h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1.5 px-1 text-xs text-muted-foreground">
                Heart-healthy: low saturated fat and good fibre per serving. Recipes without
                nutrition data won&rsquo;t show.
              </p>
            </Section>

            <Section icon={ChefHat} title="Difficulty">
              <Segmented
                options={DIFFICULTY_OPTIONS}
                value={pendingDifficulty}
                onChange={setPendingDifficulty}
              />
            </Section>

            <Section icon={Clock} title="Total time">
              <Segmented options={TIME_OPTIONS} value={pendingMaxTime} onChange={setPendingMaxTime} />
            </Section>

            {cuisines.length > 0 && (
              <Section icon={Globe2} title="Cuisine">
                <FacetPicker
                  options={cuisines}
                  selected={pendingCuisine ? [pendingCuisine] : []}
                  onToggle={(v) =>
                    setPendingCuisine(pendingCuisine.toLowerCase() === v.toLowerCase() ? "" : v)
                  }
                  placeholder="Find a cuisine…"
                  noun="cuisines"
                />
              </Section>
            )}

            {tags.length > 0 && (
              <Section
                icon={Tag}
                title="Tags"
                aside={
                  pendingTags.length > 1 && (
                    <span className="text-xs text-muted-foreground">Matches any of them</span>
                  )
                }
              >
                <FacetPicker
                  options={tags}
                  selected={pendingTags}
                  onToggle={togglePendingTag}
                  placeholder="Find a tag…"
                  noun="tags"
                />
              </Section>
            )}
          </div>

          {/* Sticky apply bar — always reachable however long the panel gets */}
          <div className="shrink-0 border-t bg-background p-4 pb-safe-bottom">
            <button
              type="button"
              onClick={applyFilters}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 py-3 text-sm font-semibold text-white shadow-md transition-opacity hover:opacity-90"
            >
              Show recipes
              {pendingFilterCount > 0 && (
                <span className="ml-1.5 opacity-80">
                  ({pendingFilterCount} {pendingFilterCount === 1 ? "filter" : "filters"})
                </span>
              )}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
