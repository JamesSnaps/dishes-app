/**
 * Meals eaten out, as the browser and the server both see them. Pure — no
 * database — so the planner's in-browser nutrition card counts them exactly
 * as Stats does on the server.
 */

import {
  MEAL_TYPES,
  OUTSIDE_MEAL_KINDS,
  OUTSIDE_MEAL_PORTIONS,
  type MealType,
  type OutsideMealKind,
  type OutsideMealPortion,
} from "@dishes/shared";
import type { MemberRating } from "@dishes/db/schema";
import type { MealFacts } from "@/lib/meal-stats";

export type OutsideMealView = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  mealType: MealType;
  kind: OutsideMealKind;
  title: string | null;
  place: string | null;
  cuisine: string | null;
  description: string | null;
  menuText: string | null;
  portion: OutsideMealPortion;
  components: string[] | null;
  mainIngredients: string[] | null;
  menuKcal: number | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  saturatedFatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  nutritionSource: "none" | "ai" | "manual";
  eatenBy: string[] | null;
  rating: number | null;
  memberRatings: MemberRating[] | null;
  notes: string | null;
  photoUrl: string | null;
  menuPhotoUrl: string | null;
};

/**
 * A synced row (the raw server row, decimals as strings) as a view. Every
 * field is narrowed rather than cast: a store holding anything odd gives a
 * meal with gaps, never one that throws later.
 */
export function outsideMealFromRecord(r: Record<string, unknown> & { id: string }): OutsideMealView | null {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);
  const date = str(r.date)?.slice(0, 10);
  if (!date) return null;
  return {
    id: r.id,
    date,
    mealType: MEAL_TYPES.find((t) => t === r.mealType) ?? "dinner",
    kind: OUTSIDE_MEAL_KINDS.find((k) => k === r.kind) ?? "eat_out",
    title: str(r.title),
    place: str(r.place),
    cuisine: str(r.cuisine),
    description: str(r.description),
    menuText: str(r.menuText),
    portion: OUTSIDE_MEAL_PORTIONS.find((p) => p === r.portion) ?? "typical",
    components: strs(r.components),
    mainIngredients: strs(r.mainIngredients),
    menuKcal: num(r.menuKcal),
    calories: num(r.calories),
    proteinG: num(r.proteinG),
    carbsG: num(r.carbsG),
    fatG: num(r.fatG),
    saturatedFatG: num(r.saturatedFatG),
    fiberG: num(r.fiberG),
    sugarG: num(r.sugarG),
    sodiumMg: num(r.sodiumMg),
    nutritionSource: r.nutritionSource === "ai" || r.nutritionSource === "manual" ? r.nutritionSource : "none",
    eatenBy: strs(r.eatenBy),
    rating: num(r.rating),
    memberRatings: Array.isArray(r.memberRatings)
      ? r.memberRatings.flatMap((x) => {
          const o = x as { name?: unknown; rating?: unknown };
          return typeof o?.name === "string" && typeof o.rating === "number" ? [{ name: o.name, rating: o.rating }] : [];
        })
      : null,
    notes: str(r.notes),
    photoUrl: str(r.photoUrl),
    menuPhotoUrl: str(r.menuPhotoUrl),
  };
}

/** "Ribeye & chips at The Swan", or the kind when there's nothing else. */
export function outsideMealLabel(m: Pick<OutsideMealView, "title" | "place">, fallback: string): string {
  if (m.title && m.place) return `${m.title} at ${m.place}`;
  return m.title || m.place || fallback;
}

// Split free text into ingredient-like pieces: "Ribeye with chips, peas & gravy"
// → ["Ribeye", "chips", "peas", "gravy"]. Needed because the protein check
// skips any name mentioning a sauce, and a whole sentence nearly always does.
const SPLIT = /,|;|\n|\+|&|\/|\bwith\b|\band\b|\bor\b/i;

export function textFragments(...texts: (string | null | undefined)[]): string[] {
  return texts
    .flatMap((t) => (t ? t.split(SPLIT) : []))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * What the protein targets read for this meal. The AI's main ingredients once
 * it has looked; before that (or with no AI key) the eater's own words, so a
 * steak still counts towards red meat straight away.
 */
export function outsideMealIngredientNames(
  m: Pick<OutsideMealView, "mainIngredients" | "components" | "title" | "description" | "menuText">
): string[] {
  if (m.mainIngredients?.length) return m.mainIngredients;
  return textFragments(...(m.components ?? []), m.title, m.menuText, m.description);
}

/** A skipped meal wasn't eaten, so it doesn't count as a meal at all. */
export function countsAsMeal(m: Pick<OutsideMealView, "kind">): boolean {
  return m.kind !== "skipped";
}

export function outsideMealFacts(m: OutsideMealView): MealFacts {
  return {
    recipeId: m.id,
    calories: m.calories,
    saturatedFatG: m.saturatedFatG,
    fiberG: m.fiberG,
    ingredientNames: outsideMealIngredientNames(m),
  };
}
