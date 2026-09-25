/**
 * Dishes Wrapped — a household's year in food, Spotify-Wrapped style.
 *
 * Built on the same reconstructed meal history as Stats (`loadMealHistory`),
 * narrowed to one calendar year. Everything here is a headline number or a
 * "top thing"; the page turns them into story slides.
 */

import { db } from "@/lib/db";
import { households } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import { PROTEIN_LABELS, proteinsOf, type ProteinKind } from "@/lib/meal-stats";
import { ateIt, loadMealHistory, type Meal } from "./meal-history";

export type WrappedRanked = { name: string; count: number };
export type WrappedRecipe = { id: string; title: string; count: number; imageUrl: string | null };

export type WrappedReport = {
  year: number;
  /** Years with at least one meal, newest first — for the year picker. */
  years: number[];
  householdName: string;
  /** True while the year is still running (numbers are "so far"). */
  inProgress: boolean;
  totals: {
    meals: number;
    distinctRecipes: number;
    newRecipes: number;
    daysCooked: number;
    cuisines: number;
    cooksLogged: number;
    minutesCooking: number;
    photos: number;
    recipesAdded: number;
    aiRecipesAdded: number;
  };
  topRecipes: WrappedRecipe[];
  topIngredients: WrappedRanked[];
  topCuisines: WrappedRanked[];
  /** Meals per month, Jan–Dec. */
  months: number[];
  busiestMonth: { name: string; count: number } | null;
  favouriteDay: { name: string; count: number } | null;
  longestStreak: number;
  topProtein: { name: string; count: number } | null;
  highestRated: { title: string; rating: number } | null;
  firstMeal: { title: string; date: string } | null;
  topContributor: { name: string; count: number } | null;
  people: { name: string; meals: number; topRecipe: string | null; topCuisine: string | null }[];
  personality: { title: string; blurb: string; emoji: string };
};

// Too common to be anyone's "top ingredient".
const STAPLES = new Set([
  "salt", "pepper", "black pepper", "salt and pepper", "sea salt", "kosher salt", "water", "oil",
  "olive oil", "extra virgin olive oil", "vegetable oil", "sunflower oil", "rapeseed oil",
  "cooking spray", "sugar", "ice", "boiling water", "cold water", "warm water",
]);

/** A comparable ingredient name: lowercase, no brackets or trailing notes. */
export function normaliseIngredient(raw: string): string | null {
  const name = raw
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .split(/[,;]/)[0]!
    .replace(/\s+/g, " ")
    .trim();
  if (!name || STAPLES.has(name)) return null;
  // Crude singular so "onions" and "onion" count together.
  if (/[^s]s$/.test(name) && !/(ss|us|is)$/.test(name) && name.length > 3) return name.slice(0, -1);
  return name;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function tally<T>(items: T[], key: (item: T) => string | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function top(counts: Map<string, number>, n: number): WrappedRanked[] {
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function longestRun(dates: string[]): number {
  const days = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let prev = 0;
  for (const d of days) {
    const t = Date.parse(d + "T00:00:00Z") / 86_400_000;
    run = t - prev === 1 ? run + 1 : 1;
    prev = t;
    best = Math.max(best, run);
  }
  return best;
}

function pickPersonality(r: {
  meals: number;
  distinct: number;
  cuisines: number;
  newRecipes: number;
  topShare: number;
  aiShare: number;
}): WrappedReport["personality"] {
  if (r.meals < 10) return { emoji: "🌱", title: "The Fresh Start", blurb: "Just getting going — next year is going to be delicious." };
  if (r.cuisines >= 8) return { emoji: "🌍", title: "The Globetrotter", blurb: "Passport? Who needs one. You ate your way around the world." };
  if (r.aiShare >= 0.3) return { emoji: "🤖", title: "The Future Foodie", blurb: "You and the AI concierge were basically a double act." };
  if (r.newRecipes / r.meals >= 0.4) return { emoji: "🧪", title: "The Experimenter", blurb: "Always something new on the stove. Boredom never stood a chance." };
  if (r.topShare >= 0.12) return { emoji: "💛", title: "The Loyalist", blurb: "You know what you love, and you love it often." };
  if (r.distinct / r.meals >= 0.6) return { emoji: "🎲", title: "The Variety Seeker", blurb: "Rarely the same dinner twice. Keeping everyone guessing." };
  return { emoji: "🏡", title: "The Comfort Cook", blurb: "Reliable favourites, happy table. That's the dream." };
}

export async function getWrappedReport(householdId: string, requestedYear?: number): Promise<WrappedReport> {
  const [history, [household]] = await Promise.all([
    loadMealHistory(householdId),
    db.select({ name: households.name }).from(households).where(eq(households.id, householdId)).limit(1),
  ]);
  const { today, allMeals, cooks, cookRows, recipeRows, recipeById, ingredientsByRecipe, memberRows } = history;

  const currentYear = Number(today.slice(0, 4));
  const years = [...new Set(allMeals.map((m) => Number(m.date.slice(0, 4))))].sort((a, b) => b - a);
  if (!years.includes(currentYear)) years.unshift(currentYear);
  const year = requestedYear && years.includes(requestedYear) ? requestedYear : currentYear;
  const prefix = String(year);
  const inYear = (date: string) => date.startsWith(prefix);

  const meals = allMeals.filter((m) => inYear(m.date));
  const firstEaten = new Map<string, string>();
  for (const m of allMeals) if (!firstEaten.has(m.recipeId)) firstEaten.set(m.recipeId, m.date);

  const distinct = new Set(meals.map((m) => m.recipeId));
  const newRecipes = [...distinct].filter((id) => inYear(firstEaten.get(id) ?? "")).length;
  const cuisineOf = (m: Meal) => recipeById.get(m.recipeId)?.cuisine?.trim() || null;

  const recipeCounts = tally(meals, (m) => m.recipeId);
  const topRecipes: WrappedRecipe[] = top(recipeCounts, 5).map(({ name: id, count }) => {
    const r = recipeById.get(id);
    return { id, title: r?.title ?? "A recipe since deleted", count, imageUrl: r?.imageUrl ?? r?.thumbnailUrl ?? null };
  });

  const ingredientCounts = new Map<string, number>();
  const proteinCounts = new Map<ProteinKind, number>();
  for (const m of meals) {
    const names = ingredientsByRecipe.get(m.recipeId) ?? [];
    for (const n of new Set(names.map(normaliseIngredient))) {
      if (n) ingredientCounts.set(n, (ingredientCounts.get(n) ?? 0) + 1);
    }
    for (const k of proteinsOf(names)) proteinCounts.set(k, (proteinCounts.get(k) ?? 0) + 1);
  }
  const topIngredients = top(ingredientCounts, 5).map((i) => ({ ...i, name: titleCase(i.name) }));
  const [proteinKind, proteinCount] = [...proteinCounts].sort((a, b) => b[1] - a[1])[0] ?? [];

  const cuisineCounts = tally(meals, cuisineOf);
  const months = MONTHS.map((_, i) => meals.filter((m) => Number(m.date.slice(5, 7)) === i + 1).length);
  const busiestIdx = months.indexOf(Math.max(...months));
  const dayCounts = tally(meals, (m) => DAYS[new Date(m.date + "T00:00:00Z").getUTCDay()]);
  const favouriteDay = top(dayCounts, 1)[0] ?? null;

  const cooksInYear = cooks.filter((c) => inYear(c.date));
  const minutesCooking = cooksInYear.reduce((a, c) => a + (c.actualDuration && c.actualDuration > 0 ? c.actualDuration : 0), 0);
  const photos = cooksInYear.filter((c) => c.photoUrl).length;

  // Best-rated recipe this year (ratings stored 0–10, shown 0–5).
  const ratings = new Map<string, { sum: number; n: number }>();
  for (const c of cookRows) {
    if (c.rating === null || !inYear(c.cookedAt.toISOString())) continue;
    const a = ratings.get(c.recipeId) ?? { sum: 0, n: 0 };
    a.sum += Number(c.rating);
    a.n += 1;
    ratings.set(c.recipeId, a);
  }
  const best = [...ratings]
    .map(([id, a]) => ({ id, rating: a.sum / a.n / 2, n: a.n }))
    .sort((a, b) => b.rating - a.rating || b.n - a.n)[0];
  const highestRated = best && recipeById.get(best.id)
    ? { title: recipeById.get(best.id)!.title, rating: Math.round(best.rating * 10) / 10 }
    : null;

  const addedThisYear = recipeRows.filter((r) => inYear(r.createdAt.toISOString()));
  const contributorCounts = tally(addedThisYear, (r) => r.createdById);
  const topContributorRow = top(contributorCounts, 1)[0];
  const contributorName = topContributorRow && memberRows.find((m) => m.id === topContributorRow.name)?.displayName;

  const people =
    memberRows.length > 1
      ? memberRows.map((p) => {
          const theirs = meals.filter((m) => ateIt(m, p.displayName));
          const fav = top(tally(theirs, (m) => m.recipeId), 1)[0];
          return {
            name: p.displayName,
            meals: theirs.length,
            topRecipe: fav ? (recipeById.get(fav.name)?.title ?? null) : null,
            topCuisine: top(tally(theirs, cuisineOf), 1)[0]?.name ?? null,
          };
        })
      : [];

  const aiEaten = meals.filter((m) => recipeById.get(m.recipeId)?.isAiGenerated).length;

  return {
    year,
    years,
    householdName: household?.name ?? "Your household",
    inProgress: year === currentYear && today < `${year}-12-31`,
    totals: {
      meals: meals.length,
      distinctRecipes: distinct.size,
      newRecipes,
      daysCooked: new Set(meals.map((m) => m.date)).size,
      cuisines: cuisineCounts.size,
      cooksLogged: cooksInYear.length,
      minutesCooking,
      photos,
      recipesAdded: addedThisYear.length,
      aiRecipesAdded: addedThisYear.filter((r) => r.isAiGenerated).length,
    },
    topRecipes,
    topIngredients,
    topCuisines: top(cuisineCounts, 5),
    months,
    busiestMonth: meals.length ? { name: MONTHS[busiestIdx]!, count: months[busiestIdx]! } : null,
    favouriteDay,
    longestStreak: longestRun(meals.map((m) => m.date)),
    topProtein: proteinKind ? { name: PROTEIN_LABELS[proteinKind], count: proteinCount! } : null,
    highestRated,
    firstMeal: meals[0] ? { title: recipeById.get(meals[0].recipeId)?.title ?? "Something delicious", date: meals[0].date } : null,
    topContributor: contributorName ? { name: contributorName, count: topContributorRow!.count } : null,
    people,
    personality: pickPersonality({
      meals: meals.length,
      distinct: distinct.size,
      cuisines: cuisineCounts.size,
      newRecipes,
      topShare: meals.length ? (topRecipes[0]?.count ?? 0) / meals.length : 0,
      aiShare: meals.length ? aiEaten / meals.length : 0,
    }),
  };
}
