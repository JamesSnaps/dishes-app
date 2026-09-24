/**
 * The Stats page's numbers: what the household has eaten, how heart-healthy it
 * was, and who ate what.
 *
 * "What we ate" is reconstructed from two records, because neither is complete
 * on its own:
 *   - meal plan entries up to today — the richest record, but a plan is only
 *     an intention;
 *   - logged cooks (cook_history, source 'cook') — confirmed, and the only
 *     place that says who was eating (`cooked_for`), but most meals never get
 *     logged.
 * A planned meal and a logged cook of the same recipe on the same day are one
 * meal. A meal counts for everyone unless a logged cook names who ate it.
 *
 * Everything is fetched once, all-time, and filtered in memory: a family's
 * whole history is a few thousand rows, and "new this period" or "not eaten
 * for months" need the all-time view anyway.
 */

import { db } from "@/lib/db";
import {
  cookHistory,
  householdMembers,
  mealPlanEntries,
  mealPlans,
  recipeIngredients,
  recipes,
} from "@dishes/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { CHOLESTEROL_DIETARY_FLAG, isHeartHealthy, mentionsCholesterolDiet } from "@/lib/heart-healthy";
import {
  PROTEIN_KINDS,
  summariseMeals,
  type MealFacts,
  type MealSummary,
  type ProteinKind,
} from "@/lib/meal-stats";

export const STATS_RANGES = {
  "4w": { label: "4 weeks", days: 28 },
  "3m": { label: "3 months", days: 91 },
  "12m": { label: "12 months", days: 365 },
  all: { label: "All time", days: null },
} as const;

export type StatsRange = keyof typeof STATS_RANGES;

export function parseRange(v: string | undefined): StatsRange {
  return v && v in STATS_RANGES ? (v as StatsRange) : "3m";
}

type Meal = {
  date: string; // YYYY-MM-DD
  recipeId: string;
  /** Display names from a logged cook, or null — everyone. */
  who: string[] | null;
};

type RecipeRow = {
  id: string;
  title: string;
  cuisine: string | null;
  calories: number | null;
  saturatedFatG: string | null;
  fiberG: string | null;
  isFavourite: boolean;
  createdAt: Date;
};

export type RankedRecipe = { id: string; title: string; count: number };

export type Bucket = {
  label: string;
  /** Tooltip text: the full period this bucket covers. */
  period: string;
  meals: number;
  withNutrition: number;
  heartHealthy: number;
};

export type PersonStats = {
  id: string;
  name: string;
  cholesterolDiet: boolean;
  summary: MealSummary;
  proteinsPerWeek: Record<ProteinKind, number>;
  topRecipes: RankedRecipe[];
  topCuisine: string | null;
};

export type StatsReport = {
  range: StatsRange;
  /** Set when the report is narrowed to one member's meals. */
  person: { id: string; name: string } | null;
  /** Every active member, for the person picker. */
  members: { id: string; name: string }[];
  /** First and last day covered (YYYY-MM-DD). */
  from: string;
  to: string;
  weeks: number;
  heartFocus: boolean;
  totals: {
    meals: number;
    cooksLogged: number;
    distinctRecipes: number;
    newRecipes: number;
    /** 0–5 stars, from cooks and ratings in the period. */
    avgRating: number | null;
    avgCookMinutes: number | null;
    libraryTotal: number;
    libraryAdded: number;
  };
  summary: MealSummary;
  proteinsPerWeek: Record<ProteinKind, number>;
  buckets: Bucket[];
  bucketUnit: "week" | "month";
  topRecipes: RankedRecipe[];
  cuisines: { name: string; count: number }[];
  people: PersonStats[];
  forgottenFavourites: { id: string; title: string; lastEaten: string | null; rating: number | null }[];
  neverEaten: number;
  heartHealthyUntried: { id: string; title: string }[];
};

// ── Date helpers (UTC, YYYY-MM-DD) ───────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function mondayOf(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

// ── Ranking helpers ──────────────────────────────────────────────────────────

function countBy<T>(items: T[], key: (item: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function topN(counts: Map<string, number>, n: number): [string, number][] {
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

function perWeek(proteins: Record<ProteinKind, number>, weeks: number): Record<ProteinKind, number> {
  return Object.fromEntries(
    PROTEIN_KINDS.map((k) => [k, Math.round((proteins[k] / weeks) * 10) / 10])
  ) as Record<ProteinKind, number>;
}

// ── The report ───────────────────────────────────────────────────────────────

export async function getStatsReport(
  householdId: string,
  range: StatsRange,
  personId?: string
): Promise<StatsReport> {
  const today = isoDate(new Date());

  const [plannedRows, cookRows, recipeRows, memberRows] = await Promise.all([
    db
      .select({
        weekStartDate: mealPlans.weekStartDate,
        dayOfWeek: mealPlanEntries.dayOfWeek,
        recipeId: mealPlanEntries.recipeId,
      })
      .from(mealPlanEntries)
      .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
      .where(eq(mealPlans.householdId, householdId)),
    db
      .select({
        recipeId: cookHistory.recipeId,
        cookedAt: cookHistory.cookedAt,
        cookedFor: cookHistory.cookedFor,
        rating: cookHistory.rating,
        actualDuration: cookHistory.actualDuration,
        source: cookHistory.source,
      })
      .from(cookHistory)
      .where(eq(cookHistory.householdId, householdId)),
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        cuisine: recipes.cuisine,
        calories: recipes.calories,
        saturatedFatG: recipes.saturatedFatG,
        fiberG: recipes.fiberG,
        isFavourite: recipes.isFavourite,
        createdAt: recipes.createdAt,
      })
      .from(recipes)
      .where(eq(recipes.householdId, householdId)),
    db
      .select({
        id: householdMembers.id,
        displayName: householdMembers.displayName,
        dietaryFlags: householdMembers.dietaryFlags,
        customNotes: householdMembers.customNotes,
      })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.isActive, true)))
      .orderBy(householdMembers.displayName),
  ]);

  const recipeById = new Map<string, RecipeRow>(recipeRows.map((r) => [r.id, r]));

  const ingredientRows = recipeRows.length
    ? await db
        .select({ recipeId: recipeIngredients.recipeId, ingredientName: recipeIngredients.ingredientName })
        .from(recipeIngredients)
        .where(inArray(recipeIngredients.recipeId, recipeRows.map((r) => r.id)))
    : [];
  const ingredientsByRecipe = new Map<string, string[]>();
  for (const row of ingredientRows) {
    const list = ingredientsByRecipe.get(row.recipeId);
    if (list) list.push(row.ingredientName);
    else ingredientsByRecipe.set(row.recipeId, [row.ingredientName]);
  }

  // ── Reconstruct every meal eaten, all-time ──────────────────────────────────

  const cooks = cookRows
    .filter((c) => c.source === "cook")
    .map((c) => ({ ...c, date: isoDate(c.cookedAt) }));

  const cookByKey = new Map<string, (typeof cooks)[number]>();
  for (const c of cooks) cookByKey.set(`${c.recipeId}|${c.date}`, c);

  const allMeals: Meal[] = [];
  const seen = new Set<string>();

  for (const p of plannedRows) {
    const date = addDays(p.weekStartDate, p.dayOfWeek);
    if (date > today) continue; // still in the future — not eaten yet
    const key = `${p.recipeId}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cook = cookByKey.get(key);
    allMeals.push({ date, recipeId: p.recipeId, who: cook?.cookedFor?.length ? cook.cookedFor : null });
  }
  for (const c of cooks) {
    const key = `${c.recipeId}|${c.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allMeals.push({ date: c.date, recipeId: c.recipeId, who: c.cookedFor?.length ? c.cookedFor : null });
  }
  allMeals.sort((a, b) => a.date.localeCompare(b.date));

  // ── The period ───────────────────────────────────────────────────────────────

  const rangeDays = STATS_RANGES[range].days;
  const firstEver = allMeals[0]?.date ?? today;
  const from = rangeDays === null ? firstEver : addDays(today, -(rangeDays - 1));
  // One person's report: only the meals they ate (everyone's, unless a logged
  // cook names who was eating). Scoped to this household's members, so a
  // stray id just falls back to the whole household.
  const personRow = personId ? memberRows.find((m) => m.id === personId) : undefined;
  const ateIt = (m: Meal, displayName: string) => {
    const name = displayName.trim().toLowerCase();
    return m.who === null || m.who.some((w) => w.trim().toLowerCase() === name);
  };
  const meals = allMeals.filter(
    (m) => m.date >= from && m.date <= today && (!personRow || ateIt(m, personRow.displayName))
  );
  const weeks = Math.max(1, (daysBetween(from, today) + 1) / 7);

  const factsOf = (m: Meal): MealFacts => {
    const r = recipeById.get(m.recipeId);
    return {
      recipeId: m.recipeId,
      calories: r?.calories ?? null,
      saturatedFatG: r?.saturatedFatG ?? null,
      fiberG: r?.fiberG ?? null,
      ingredientNames: ingredientsByRecipe.get(m.recipeId) ?? [],
    };
  };

  const summary = summariseMeals(meals.map(factsOf));

  // ── Totals ───────────────────────────────────────────────────────────────────

  const firstEaten = new Map<string, string>();
  const lastEaten = new Map<string, string>();
  for (const m of allMeals) {
    if (!firstEaten.has(m.recipeId)) firstEaten.set(m.recipeId, m.date);
    lastEaten.set(m.recipeId, m.date);
  }

  const distinct = new Set(meals.map((m) => m.recipeId));
  const newRecipes = [...distinct].filter((id) => (firstEaten.get(id) ?? "") >= from).length;

  const cooksInRange = cooks.filter((c) => c.date >= from && c.date <= today);
  const ratingsInRange = cookRows
    .filter((c) => c.rating !== null && isoDate(c.cookedAt) >= from)
    .map((c) => Number(c.rating));
  const durations = cooksInRange.map((c) => c.actualDuration).filter((d): d is number => d !== null && d > 0);

  // ── Chart buckets: weeks for short ranges, months beyond ────────────────────

  const bucketUnit: "week" | "month" = weeks <= 14 ? "week" : "month";
  const bucketKey = (date: string) => (bucketUnit === "week" ? mondayOf(date) : date.slice(0, 7));
  const bucketKeys: string[] = [];
  if (bucketUnit === "week") {
    for (let d = mondayOf(from); d <= today; d = addDays(d, 7)) bucketKeys.push(d);
  } else {
    const cursor = new Date(from.slice(0, 7) + "-01T00:00:00Z");
    while (isoDate(cursor).slice(0, 7) <= today.slice(0, 7)) {
      bucketKeys.push(isoDate(cursor).slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const mealsByBucket = new Map<string, Meal[]>();
  for (const m of meals) {
    const k = bucketKey(m.date);
    const list = mealsByBucket.get(k);
    if (list) list.push(m);
    else mealsByBucket.set(k, [m]);
  }
  const buckets: Bucket[] = bucketKeys.map((k) => {
    const s = summariseMeals((mealsByBucket.get(k) ?? []).map(factsOf));
    const start = bucketUnit === "week" ? k : `${k}-01`;
    return {
      label: bucketUnit === "week" ? SHORT_DATE.format(new Date(start + "T00:00:00Z")) : MONTH.format(new Date(start + "T00:00:00Z")),
      period:
        bucketUnit === "week"
          ? `Week of ${SHORT_DATE.format(new Date(start + "T00:00:00Z"))}`
          : MONTH.format(new Date(start + "T00:00:00Z")),
      meals: s.meals,
      withNutrition: s.withNutrition,
      heartHealthy: s.heartHealthy,
    };
  });

  // ── Rankings ─────────────────────────────────────────────────────────────────

  const rank = (list: Meal[], n: number): RankedRecipe[] =>
    topN(countBy(list, (m) => m.recipeId), n).map(([id, count]) => ({
      id,
      title: recipeById.get(id)?.title ?? "Deleted recipe",
      count,
    }));

  const cuisineCounts = countBy(meals, (m) => recipeById.get(m.recipeId)?.cuisine ?? "Unspecified");
  const cuisines = topN(cuisineCounts, 8).map(([name, count]) => ({ name, count }));
  const shown = cuisines.reduce((a, c) => a + c.count, 0);
  if (meals.length > shown) cuisines.push({ name: "Other", count: meals.length - shown });

  // ── People ───────────────────────────────────────────────────────────────────

  const people: PersonStats[] = (personRow ? [personRow] : memberRows).map((m) => {
    const theirs = meals.filter((meal) => ateIt(meal, m.displayName));
    const s = summariseMeals(theirs.map(factsOf));
    const topCuisine =
      topN(countBy(theirs, (meal) => recipeById.get(meal.recipeId)?.cuisine ?? null), 1)[0]?.[0] ?? null;
    return {
      id: m.id,
      name: m.displayName,
      cholesterolDiet:
        (m.dietaryFlags ?? []).includes(CHOLESTEROL_DIETARY_FLAG) || mentionsCholesterolDiet([m.customNotes]),
      summary: s,
      proteinsPerWeek: perWeek(s.proteins, weeks),
      topRecipes: rank(theirs, 3),
      topCuisine,
    };
  });

  // ── Worth a look ─────────────────────────────────────────────────────────────

  const ratingSums = new Map<string, { sum: number; n: number }>();
  for (const c of cookRows) {
    if (c.rating === null) continue;
    const a = ratingSums.get(c.recipeId) ?? { sum: 0, n: 0 };
    a.sum += Number(c.rating);
    a.n += 1;
    ratingSums.set(c.recipeId, a);
  }
  const ratingOf = (id: string) => {
    const a = ratingSums.get(id);
    return a ? Math.round((a.sum / a.n / 2) * 10) / 10 : null; // stored 0–10, shown 0–5
  };

  // Loved (starred, or rated 4+) but not eaten in eight weeks.
  const eightWeeksAgo = addDays(today, -56);
  const forgottenFavourites = recipeRows
    .filter((r) => r.isFavourite || (ratingOf(r.id) ?? 0) >= 4)
    .filter((r) => (lastEaten.get(r.id) ?? "") < eightWeeksAgo)
    .map((r) => ({ id: r.id, title: r.title, lastEaten: lastEaten.get(r.id) ?? null, rating: ratingOf(r.id) }))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (a.lastEaten ?? "").localeCompare(b.lastEaten ?? ""))
    .slice(0, 6);

  const heartHealthyUntried = recipeRows
    .filter((r) => !firstEaten.has(r.id) && isHeartHealthy(r))
    .slice(0, 6)
    .map((r) => ({ id: r.id, title: r.title }));

  return {
    range,
    person: personRow ? { id: personRow.id, name: personRow.displayName } : null,
    members: memberRows.map((m) => ({ id: m.id, name: m.displayName })),
    from,
    to: today,
    weeks,
    heartFocus: people.some((p) => p.cholesterolDiet),
    totals: {
      meals: meals.length,
      cooksLogged: cooksInRange.length,
      distinctRecipes: distinct.size,
      newRecipes,
      avgRating: ratingsInRange.length
        ? Math.round((ratingsInRange.reduce((a, b) => a + b, 0) / ratingsInRange.length / 2) * 10) / 10
        : null,
      avgCookMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      libraryTotal: recipeRows.length,
      libraryAdded: recipeRows.filter((r) => isoDate(r.createdAt) >= from).length,
    },
    summary,
    proteinsPerWeek: perWeek(summary.proteins, weeks),
    buckets,
    bucketUnit,
    topRecipes: rank(meals, 8),
    cuisines,
    people,
    forgottenFavourites,
    neverEaten: recipeRows.filter((r) => !firstEaten.has(r.id)).length,
    heartHealthyUntried,
  };
}
