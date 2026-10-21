"use client";

import Link from "next/link";
import { BookOpen, CheckCircle2, ChefHat, Clock, Heart, History, LayoutGrid, Sparkles, UtensilsCrossed } from "lucide-react";
import { RecipeCard } from "./recipe-card";

/**
 * Browse mode for /recipes, which replaced the Home page (17 Oct 2026: Home
 * was "just a collection of recipes mostly"). With nothing searched, filtered
 * or sorted (see `isBrowsing`), the page shows tonight's meal and shelves of
 * recipes instead of the whole grid. "See all" on a shelf opens the grid with
 * the filter or sort that lists the same recipes.
 *
 * The iOS app's Recipes tab does the same (RecipesBrowse.swift) — keep the
 * shelves, their order and their rules in step.
 */

export type BrowseRecipe = {
  id: string;
  title: string;
  description: string | null;
  cuisine: string | null;
  mealRole?: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  calories: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  isFavourite: boolean;
  isAiGenerated: boolean;
  heartHealthy?: boolean;
  averageRating: number | null;
  cookCount: number;
  lastCookedAt?: string | null;
  createdAt?: string | null;
};

export type BrowseTonight = {
  mealType: string;
  title: string;
  serveAt: string | null;
  dishCount: number;
  /** The dish to open cooking mode on: the main, else the first. */
  cookHref: string;
  recipeHref: string;
  /** Made already (a cook logged today for every dish): nothing left to cook tonight. */
  cooked: boolean;
  imageUrl: string | null;
  totalMinutes: number | null;
} | null;

export type BrowseSuggestion = { id: string; whyText: string | null };

const PER_SHELF = 12;

function minutes(total: number | null): string | null {
  if (!total) return null;
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const RELATIVE = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

/** "4 hours ago", "3 days ago", "last month" — as iOS's `.relative(presentation: .named)`. */
function cookedAgo(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const hours = Math.round(ms / 3_600_000);
  if (hours > -1) return RELATIVE.format(Math.round(ms / 60_000), "minute");
  if (hours > -24) return RELATIVE.format(hours, "hour");
  const days = Math.round(ms / 86_400_000);
  if (days > -7) return RELATIVE.format(days, "day");
  if (days > -30) return RELATIVE.format(Math.round(days / 7), "week");
  if (days > -365) return RELATIVE.format(Math.round(days / 30), "month");
  return RELATIVE.format(Math.round(days / 365), "year");
}

export function RecipesBrowse({
  recipes,
  suggested,
  tonight,
  wrappedYear,
}: {
  recipes: BrowseRecipe[];
  suggested: BrowseSuggestion[];
  tonight: BrowseTonight;
  /** Set in December and January, when Wrapped is brought to the front. */
  wrappedYear: number | null;
}) {
  const favourites = recipes.filter((r) => r.isFavourite).sort((a, b) => a.title.localeCompare(b.title));
  const cooked = recipes
    .filter((r) => r.lastCookedAt)
    .sort((a, b) => b.lastCookedAt!.localeCompare(a.lastCookedAt!));
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const picks = suggested.flatMap((s) => {
    const r = byId.get(s.id);
    return r ? [{ recipe: r, why: s.whyText }] : [];
  });
  const recent = [...recipes].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  // Cuisines by use; the chips take the top 8, the shelves the top 3 with enough to browse.
  const cuisineCounts = new Map<string, { name: string; count: number }>();
  for (const r of recipes) {
    if (!r.cuisine) continue;
    const key = r.cuisine.toLowerCase();
    const c = cuisineCounts.get(key) ?? { name: r.cuisine, count: 0 };
    c.count += 1;
    cuisineCounts.set(key, c);
  }
  const cuisines = [...cuisineCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return (
    <div className="space-y-7">
      {/* Quick ways into the grid, as the iOS chip row */}
      <div className="-mx-4 lg:-mx-8">
        <div className="flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:px-8">
          <Chip href="/recipes?view=all" icon={<LayoutGrid className="h-3.5 w-3.5" />} label="All" count={recipes.length} />
          <Chip href="/recipes?favourites=1" icon={<Heart className="h-3.5 w-3.5" />} label="Favourites" count={favourites.length} />
          <div className="h-5 w-px shrink-0 self-center bg-border" />
          {cuisines.slice(0, 8).map((c) => (
            <Chip key={c.name} href={`/recipes?cuisine=${encodeURIComponent(c.name)}`} label={c.name} count={c.count} />
          ))}
        </div>
      </div>

      <TonightBanner tonight={tonight} />

      {wrappedYear && (
        <Link
          href={`/wrapped?year=${wrappedYear}`}
          className="relative block overflow-hidden rounded-2xl bg-gradient-to-br from-fuchsia-600 via-rose-500 to-orange-400 p-5 text-white shadow-lg transition-transform hover:scale-[1.01]"
        >
          <span aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-yellow-300/40 blur-2xl" />
          <span className="relative block text-xs font-bold uppercase tracking-[0.2em] text-white/85">Dishes Wrapped</span>
          <span className="relative mt-1 block text-2xl font-black">Your {wrappedYear} in food is here ✨</span>
          <span className="relative mt-3 inline-block rounded-full bg-white px-4 py-1.5 text-sm font-bold text-rose-600 shadow">
            Play it →
          </span>
        </Link>
      )}

      <Shelf
        title="Favourites"
        icon={<Heart className="h-4 w-4 fill-rose-400 text-rose-500" />}
        href="/recipes?favourites=1"
        items={favourites.map((recipe) => ({ recipe }))}
      />
      <Shelf
        title="Cook again"
        icon={<History className="h-4 w-4 text-primary" />}
        href="/recipes?sort=cooked"
        items={cooked.map((recipe) => ({ recipe, caption: `Cooked ${cookedAgo(recipe.lastCookedAt!)}` }))}
      />
      <Shelf
        title="Suggested for you"
        icon={<Sparkles className="h-4 w-4 text-violet-500" />}
        items={picks.map(({ recipe, why }) => ({ recipe, caption: why }))}
      />
      <Shelf title="Recently added" href="/recipes?view=all" items={recent.map((recipe) => ({ recipe }))} />
      {cuisines
        .filter((c) => c.count >= 3)
        .slice(0, 3)
        .map((c) => (
          <Shelf
            key={c.name}
            title={c.name}
            href={`/recipes?cuisine=${encodeURIComponent(c.name)}`}
            items={recipes
              .filter((r) => r.cuisine?.toLowerCase() === c.name.toLowerCase())
              .map((recipe) => ({ recipe }))}
          />
        ))}
    </div>
  );
}

function Chip({ href, icon, label, count }: { href: string; icon?: React.ReactNode; label: string; count: number }) {
  return (
    <Link
      href={href}
      className="flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      {icon}
      {label}
      <span className="text-xs text-muted-foreground">{count}</span>
    </Link>
  );
}

/** A titled row of cards that scrolls sideways, running to the page's edges. */
function Shelf({
  title,
  icon,
  href,
  items,
}: {
  title: string;
  icon?: React.ReactNode;
  href?: string;
  items: { recipe: BrowseRecipe; caption?: string | null }[];
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          {icon}
          {title}
        </h2>
        {href && (
          <Link href={href} className="text-sm font-medium text-primary hover:underline">
            See all
          </Link>
        )}
      </div>
      {/* scroll-px matches px: snapping lines a card up with the scroll padding,
          so without it the first card snaps flush to the screen edge. */}
      <div className="-mx-4 lg:-mx-8">
        <div className="flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 scrollbar-none lg:gap-4 lg:scroll-px-8 lg:px-8">
          {items.slice(0, PER_SHELF).map(({ recipe, caption }) => (
            <div key={recipe.id} className="w-40 shrink-0 snap-start sm:w-48 lg:w-52">
              <RecipeCard {...recipe} />
              {caption && <p className="mt-1.5 line-clamp-2 px-0.5 text-xs text-muted-foreground">{caption}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TonightBanner({ tonight }: { tonight: BrowseTonight }) {
  if (!tonight) {
    return (
      <Link
        href="/meal-plan"
        className="flex items-center gap-4 rounded-2xl border bg-gradient-to-r from-orange-50 to-rose-50 p-4 shadow-sm transition-shadow hover:shadow-md dark:from-orange-950/30 dark:to-rose-950/30"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-500 dark:bg-orange-950/60">
          <UtensilsCrossed className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Nothing planned tonight</span>
          <span className="block text-sm text-muted-foreground">Pick something from your recipes in the planner</span>
        </span>
        <span className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm">
          Plan tonight
        </span>
      </Link>
    );
  }

  const time = tonight.dishCount === 1 && !tonight.cooked ? minutes(tonight.totalMinutes) : null;
  return (
    <div
      className={`flex items-center gap-4 rounded-2xl bg-gradient-to-r p-4 text-white shadow-lg ${
        tonight.cooked ? "from-emerald-600 to-teal-500 shadow-emerald-600/25" : "from-orange-500 to-rose-500 shadow-orange-500/25"
      }`}
    >
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/15 ring-1 ring-white/35 sm:h-28 sm:w-28">
        {tonight.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tonight.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <UtensilsCrossed className="h-8 w-8 text-white/60" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-white/85">
          {tonight.cooked && <CheckCircle2 className="h-3.5 w-3.5" />}
          {tonight.cooked ? "Cooked tonight" : "Tonight"} · {tonight.mealType}
        </p>
        <p className="mt-0.5 line-clamp-2 text-lg font-bold leading-tight sm:text-xl">{tonight.title}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs font-medium text-white/90">
          {tonight.serveAt && !tonight.cooked && <span>Serve at {tonight.serveAt}</span>}
          {tonight.dishCount > 1 && <span>{tonight.dishCount} dishes</span>}
          {time && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {time}
            </span>
          )}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          {tonight.cooked ? (
            <Link
              href={tonight.recipeHref}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3.5 py-1.5 text-sm font-bold text-emerald-700 shadow-sm transition-transform active:scale-95"
            >
              <BookOpen className="h-4 w-4" />
              View recipe
            </Link>
          ) : (
            <Link
              href={tonight.cookHref}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3.5 py-1.5 text-sm font-bold text-orange-600 shadow-sm transition-transform active:scale-95"
            >
              <ChefHat className="h-4 w-4" />
              Start cooking
            </Link>
          )}
          <Link href="/meal-plan" className="whitespace-nowrap rounded-full bg-white/20 px-3.5 py-1.5 text-sm font-semibold hover:bg-white/30">
            Plan
          </Link>
        </div>
      </div>
    </div>
  );
}
