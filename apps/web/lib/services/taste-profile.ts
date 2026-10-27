/**
 * Taste profile domain logic. Not a "use server" module: every function takes
 * a householdId, so it must only be called by server code that has already
 * resolved the caller's membership (pages, services, the v1 actions route).
 * Exporting these from a "use server" file would let any signed-in browser
 * call them with another household's id.
 */

import { db } from "@/lib/db";
import {
  cookHistory,
  outsideMeals,
  recipes,
  recipeIngredients,
  recipeTags,
  tasteProfiles,
} from "@dishes/db/schema";
import { and, desc, eq, inArray, isNotNull, notExists } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TasteProfile = {
  cuisines: Record<string, number>;
  ingredients: Record<string, number>;
  tags: Record<string, number>;
  mealTypes: Record<string, number>;
  ratedCookCount: number;
  updatedAt: string;
};

// ── Internal helpers ──────────────────────────────────────────────────────────

type Sample = { rating: number; weight: number };

function weightedAvg(samples: Sample[]): number {
  const totalWeight = samples.reduce((s, x) => s + x.weight, 0);
  const sum = samples.reduce((s, x) => s + x.rating * x.weight, 0);
  return Math.round((sum / totalWeight) * 10) / 10;
}

function buildScores(
  map: Map<string, Sample[]>,
  minSamples: number,
  limit: number
): Record<string, number> {
  const entries: [string, number][] = [];
  for (const [key, samples] of map.entries()) {
    if (samples.length >= minSamples) {
      entries.push([key, weightedAvg(samples)]);
    }
  }
  return Object.fromEntries(entries.sort(([, a], [, b]) => b - a).slice(0, limit));
}

// ── refreshTasteProfile ───────────────────────────────────────────────────────

export async function refreshTasteProfile(householdId: string): Promise<void> {
  const ratedCooks = await db
    .select({
      recipeId: cookHistory.recipeId,
      rating: cookHistory.rating,
      cookedAt: cookHistory.cookedAt,
      cuisine: recipes.cuisine,
    })
    .from(cookHistory)
    .innerJoin(recipes, eq(cookHistory.recipeId, recipes.id))
    .where(
      and(eq(cookHistory.householdId, householdId), isNotNull(cookHistory.rating))
    );

  // Rated meals eaten out say what the family likes too — the Thai place they
  // loved — through their cuisine and main ingredients. No recipe, no tags.
  const ratedOut = await db
    .select({
      rating: outsideMeals.rating,
      date: outsideMeals.date,
      cuisine: outsideMeals.cuisine,
      mainIngredients: outsideMeals.mainIngredients,
    })
    .from(outsideMeals)
    .where(and(eq(outsideMeals.householdId, householdId), isNotNull(outsideMeals.rating)));

  if (ratedCooks.length === 0 && ratedOut.length === 0) {
    await db
      .insert(tasteProfiles)
      .values({
        householdId,
        cuisines: {},
        ingredients: {},
        tags: {},
        mealTypes: {},
        ratedCookCount: 0,
      })
      .onConflictDoUpdate({
        target: tasteProfiles.householdId,
        set: {
          cuisines: {},
          ingredients: {},
          tags: {},
          mealTypes: {},
          ratedCookCount: 0,
          updatedAt: new Date(),
        },
      });
    return;
  }

  const recipeIds = [...new Set(ratedCooks.map((c) => c.recipeId))];

  const [allTags, allIngredients] = !recipeIds.length ? [[], []] : await Promise.all([
    db
      .select({ recipeId: recipeTags.recipeId, tag: recipeTags.tag })
      .from(recipeTags)
      .where(inArray(recipeTags.recipeId, recipeIds)),
    db
      .select({
        recipeId: recipeIngredients.recipeId,
        ingredientName: recipeIngredients.ingredientName,
      })
      .from(recipeIngredients)
      .where(inArray(recipeIngredients.recipeId, recipeIds)),
  ]);

  const tagsByRecipe = new Map<string, string[]>();
  for (const row of allTags) {
    const arr = tagsByRecipe.get(row.recipeId) ?? [];
    arr.push(row.tag.toLowerCase());
    tagsByRecipe.set(row.recipeId, arr);
  }

  const ingredientsByRecipe = new Map<string, string[]>();
  for (const row of allIngredients) {
    const arr = ingredientsByRecipe.get(row.recipeId) ?? [];
    arr.push(row.ingredientName.toLowerCase());
    ingredientsByRecipe.set(row.recipeId, arr);
  }

  const now = Date.now();
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  const cuisineMap = new Map<string, Sample[]>();
  const tagMap = new Map<string, Sample[]>();
  const ingredientMap = new Map<string, Sample[]>();

  for (const cook of ratedCooks) {
    const rating = parseFloat(cook.rating!);
    if (isNaN(rating)) continue;
    const weeksAgo = (now - cook.cookedAt.getTime()) / MS_PER_WEEK;
    const weight = 1 / (1 + weeksAgo * 0.1);

    if (cook.cuisine) {
      const key = cook.cuisine.toLowerCase();
      const arr = cuisineMap.get(key) ?? [];
      arr.push({ rating, weight });
      cuisineMap.set(key, arr);
    }

    for (const tag of tagsByRecipe.get(cook.recipeId) ?? []) {
      const arr = tagMap.get(tag) ?? [];
      arr.push({ rating, weight });
      tagMap.set(tag, arr);
    }

    for (const name of ingredientsByRecipe.get(cook.recipeId) ?? []) {
      const arr = ingredientMap.get(name) ?? [];
      arr.push({ rating, weight });
      ingredientMap.set(name, arr);
    }
  }

  for (const meal of ratedOut) {
    const rating = parseFloat(meal.rating!);
    if (isNaN(rating)) continue;
    const weeksAgo = (now - Date.parse(`${meal.date}T12:00:00Z`)) / MS_PER_WEEK;
    const weight = 1 / (1 + Math.max(0, weeksAgo) * 0.1);
    const add = (map: Map<string, Sample[]>, key: string) => map.set(key, [...(map.get(key) ?? []), { rating, weight }]);
    if (meal.cuisine) add(cuisineMap, meal.cuisine.toLowerCase());
    for (const name of meal.mainIngredients ?? []) add(ingredientMap, name.toLowerCase());
  }

  const cuisines = buildScores(cuisineMap, 1, 20);
  const tags = buildScores(tagMap, 1, 30);
  const ingredients = buildScores(ingredientMap, 1, 50);

  await db
    .insert(tasteProfiles)
    .values({
      householdId,
      cuisines,
      ingredients,
      tags,
      mealTypes: {},
      ratedCookCount: ratedCooks.length + ratedOut.length,
    })
    .onConflictDoUpdate({
      target: tasteProfiles.householdId,
      set: {
        cuisines,
        ingredients,
        tags,
        mealTypes: {},
        ratedCookCount: ratedCooks.length + ratedOut.length,
        updatedAt: new Date(),
      },
    });
}

// ── getTasteProfile ───────────────────────────────────────────────────────────

export async function getTasteProfile(
  householdId: string
): Promise<TasteProfile | null> {
  const [row] = await db
    .select()
    .from(tasteProfiles)
    .where(eq(tasteProfiles.householdId, householdId))
    .limit(1);

  if (!row) return null;
  return {
    cuisines: row.cuisines,
    ingredients: row.ingredients,
    tags: row.tags,
    mealTypes: row.mealTypes,
    ratedCookCount: row.ratedCookCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── getSuggestedRecipes ───────────────────────────────────────────────────────

export type SuggestedRecipe = {
  id: string;
  title: string;
  description: string | null;
  cuisine: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  isFavourite: boolean;
  isAiGenerated: boolean;
  whyText: string;
};

export async function getSuggestedRecipes(
  householdId: string,
  limit = 6
): Promise<SuggestedRecipe[]> {
  const profile = await getTasteProfile(householdId);
  if (!profile || profile.ratedCookCount < 2) return [];

  const { cuisines, ingredients, tags } = profile;

  // Recipes this household has never cooked
  const candidates = await db
    .select({
      id: recipes.id,
      title: recipes.title,
      description: recipes.description,
      cuisine: recipes.cuisine,
      prepTimeMinutes: recipes.prepTimeMinutes,
      cookTimeMinutes: recipes.cookTimeMinutes,
      imageUrl: recipes.imageUrl,
      thumbnailUrl: recipes.thumbnailUrl,
      isFavourite: recipes.isFavourite,
      isAiGenerated: recipes.isAiGenerated,
    })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, householdId),
        notExists(
          db
            .select({ id: cookHistory.id })
            .from(cookHistory)
            .where(
              and(
                eq(cookHistory.recipeId, recipes.id),
                eq(cookHistory.householdId, householdId)
              )
            )
        )
      )
    )
    .orderBy(desc(recipes.createdAt))
    .limit(100);

  if (candidates.length === 0) return [];

  const ids = candidates.map((r) => r.id);
  const [allTags, allIngredients] = await Promise.all([
    db
      .select({ recipeId: recipeTags.recipeId, tag: recipeTags.tag })
      .from(recipeTags)
      .where(inArray(recipeTags.recipeId, ids)),
    db
      .select({ recipeId: recipeIngredients.recipeId, ingredientName: recipeIngredients.ingredientName })
      .from(recipeIngredients)
      .where(inArray(recipeIngredients.recipeId, ids)),
  ]);

  const tagsByRecipe = new Map<string, string[]>();
  for (const r of allTags) {
    const arr = tagsByRecipe.get(r.recipeId) ?? [];
    arr.push(r.tag.toLowerCase());
    tagsByRecipe.set(r.recipeId, arr);
  }

  const ingredientsByRecipe = new Map<string, string[]>();
  for (const r of allIngredients) {
    const arr = ingredientsByRecipe.get(r.recipeId) ?? [];
    arr.push(r.ingredientName.toLowerCase());
    ingredientsByRecipe.set(r.recipeId, arr);
  }

  const scored = candidates.map((recipe) => {
    const reasons: { label: string; score: number }[] = [];
    let total = 0;

    if (recipe.cuisine) {
      const s = cuisines[recipe.cuisine.toLowerCase()];
      if (s !== undefined) {
        total += s * 2;
        reasons.push({ label: recipe.cuisine, score: s });
      }
    }

    const recipeIngredientNames = ingredientsByRecipe.get(recipe.id) ?? [];
    const matchedIngredients = recipeIngredientNames
      .map((name) => ({ name, score: ingredients[name] }))
      .filter((x): x is { name: string; score: number } => x.score !== undefined);

    if (matchedIngredients.length > 0) {
      const avg = matchedIngredients.reduce((s, x) => s + x.score, 0) / matchedIngredients.length;
      total += avg * 1.5;
      matchedIngredients
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .forEach((x) => reasons.push({ label: x.name, score: x.score }));
    }

    const recipTagNames = tagsByRecipe.get(recipe.id) ?? [];
    const matchedTags = recipTagNames
      .map((t) => ({ name: t, score: tags[t] }))
      .filter((x): x is { name: string; score: number } => x.score !== undefined);

    if (matchedTags.length > 0) {
      const avg = matchedTags.reduce((s, x) => s + x.score, 0) / matchedTags.length;
      total += avg;
      matchedTags
        .sort((a, b) => b.score - a.score)
        .slice(0, 1)
        .forEach((x) => reasons.push({ label: x.name, score: x.score }));
    }

    const topReasons = reasons
      .filter((r) => r.score >= 3.0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((r) => r.label);

    const whyText =
      topReasons.length > 0
        ? `Matches your taste: ${topReasons.join(", ")}`
        : "Based on your cooking history";

    return { ...recipe, score: total, whyText };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}
