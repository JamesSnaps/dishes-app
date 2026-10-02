/**
 * Swap suggestions for a planned week: which meals to change, and to what,
 * so the week lands on the heart-healthy protein targets in `meal-stats.ts`.
 *
 * Pure and client-side — the planner already holds every recipe in the
 * library with its ingredients and nutrition, so no round trip is needed. The
 * AI fallback (when the library has nothing suitable) lives in
 * `suggestSwapConcepts` in `app/actions/ai.ts`.
 */

import { isHeartHealthy } from "./heart-healthy";
import {
  PROTEIN_LABELS,
  WEEKLY_PROTEIN_TARGETS,
  proteinsOf,
  type ProteinKind,
} from "./meal-stats";

export type SwapEntry = {
  id: string;
  dayOfWeek: number;
  mealType: string;
  recipeId: string;
};

export type SwapRecipe = {
  id: string;
  title: string;
  cuisine: string | null;
  avgRating: number | null;
  isFavourite: boolean;
  ingredientNames: string[];
  saturatedFatG?: number | string | null;
  fiberG?: number | string | null;
  /** Empty or missing means "unknown" — allowed for any slot. */
  mealTypes?: string[];
};

export type SwapGap = {
  kind: ProteinKind;
  /** "add" — the week needs more of this; "cut" — it has too much. */
  direction: "add" | "cut";
  /** How many meals need to change to close the gap. */
  needed: number;
};

export type SwapSuggestion = {
  entryId: string;
  dayOfWeek: number;
  mealType: string;
  fromRecipeId: string;
  fromTitle: string;
  gap: SwapGap;
  /** Best library match, or null when the AI fallback is the only option. */
  toRecipe: SwapRecipe | null;
  /** Next-best library matches, for "Other ideas". */
  alternatives: SwapRecipe[];
  /** Short "why" line, e.g. "adds oily fish". */
  reason: string;
};

// Main meals only — swapping a snack for a salmon traybake helps nobody.
const SWAPPABLE_MEAL_TYPES = new Set(["lunch", "dinner"]);
const LIMIT_KINDS: ProteinKind[] = ["redMeat", "processedMeat"];
// 0–5 stars. Rated this low, it's not a fix for the week — the household
// already said no. Matches the AI meal planner's cut-off.
const DISLIKED_AT = 2;

export function gapReason(gap: SwapGap): string {
  const label = PROTEIN_LABELS[gap.kind].toLowerCase();
  return gap.direction === "add" ? `adds ${label}` : `cuts ${label}`;
}

/** Targets the week misses, most important first (cuts before adds). */
export function weekGaps(proteins: Record<ProteinKind, number>): SwapGap[] {
  const gaps: SwapGap[] = [];
  for (const [kind, t] of Object.entries(WEEKLY_PROTEIN_TARGETS) as [
    ProteinKind,
    { min?: number; max?: number },
  ][]) {
    const count = proteins[kind];
    if (t.max !== undefined && count > t.max) {
      gaps.push({ kind, direction: "cut", needed: count - t.max });
    } else if (t.min !== undefined && count < t.min) {
      gaps.push({ kind, direction: "add", needed: t.min - count });
    }
  }
  return gaps.sort((a, b) => (a.direction === b.direction ? 0 : a.direction === "cut" ? -1 : 1));
}

function fitsSlot(recipe: SwapRecipe, mealType: string): boolean {
  return !recipe.mealTypes?.length || recipe.mealTypes.includes(mealType);
}

/**
 * Library recipes that would fix `gap` in a `mealType` slot, best first:
 * has what's needed, adds no red or processed meat, isn't rated 2★ or less, then heart-healthy,
 * favourite, rating, and same cuisine as the meal it replaces.
 */
function rankReplacements(
  gap: SwapGap,
  mealType: string,
  from: SwapRecipe | undefined,
  library: SwapRecipe[],
  proteinsById: Map<string, Set<ProteinKind>>,
  excluded: Set<string>,
  otherAddGaps: ProteinKind[]
): SwapRecipe[] {
  const scored: { recipe: SwapRecipe; score: number }[] = [];
  for (const recipe of library) {
    if (excluded.has(recipe.id) || !fitsSlot(recipe, mealType)) continue;
    const kinds = proteinsById.get(recipe.id)!;
    if (LIMIT_KINDS.some((k) => kinds.has(k))) continue;
    if (recipe.avgRating != null && recipe.avgRating <= DISLIKED_AT) continue;
    if (gap.direction === "add" && !kinds.has(gap.kind)) continue;
    // A main needs a main: unless the recipe is tagged for this slot, it must
    // have a protein — otherwise "no red meat" matches the cookie recipe.
    if (kinds.size === 0 && !recipe.mealTypes?.includes(mealType)) continue;

    let score = 0;
    if (isHeartHealthy(recipe)) score += 4;
    // A cut that also closes an "add" gap is worth two swaps.
    if (gap.direction === "cut" && otherAddGaps.some((k) => kinds.has(k))) score += 3;
    if (recipe.isFavourite) score += 1.5;
    score += recipe.avgRating ?? 2.5; // unrated sits mid-table
    if (from?.cuisine && recipe.cuisine && from.cuisine.toLowerCase() === recipe.cuisine.toLowerCase()) {
      score += 1;
    }
    scored.push({ recipe, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.recipe);
}

/**
 * Pick meals to swap and what to swap them for. Each entry is suggested at
 * most once, and each replacement recipe is used at most once (and never one
 * already planned this week).
 */
export function suggestSwaps(
  entries: SwapEntry[],
  library: SwapRecipe[],
  proteins: Record<ProteinKind, number>
): SwapSuggestion[] {
  const gaps = weekGaps(proteins);
  if (!gaps.length) return [];

  const byId = new Map(library.map((r) => [r.id, r]));
  const proteinsById = new Map(library.map((r) => [r.id, proteinsOf(r.ingredientNames)]));
  const kindsOf = (recipeId: string) => proteinsById.get(recipeId) ?? new Set<ProteinKind>();

  const plannedRecipeIds = new Set(entries.map((e) => e.recipeId));
  const usedEntries = new Set<string>();
  const usedRecipes = new Set(plannedRecipeIds);
  const addKinds = gaps.filter((g) => g.direction === "add").map((g) => g.kind);
  const suggestions: SwapSuggestion[] = [];
  // Shrinks as suggestions land: swapping red meat for a lentil dish also
  // counts towards the lentil target, so that gap needs one fewer swap.
  const remaining = new Map(gaps.map((g) => [g.kind, g.needed]));

  // Candidate meals in day order, so suggestions read Monday → Sunday.
  const swappable = entries
    .filter((e) => SWAPPABLE_MEAL_TYPES.has(e.mealType))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  for (const gap of gaps) {
    let candidates: SwapEntry[];
    if (gap.direction === "cut") {
      candidates = swappable.filter((e) => kindsOf(e.recipeId).has(gap.kind));
    } else {
      // Don't take away a meal that's already pulling its weight on a target.
      candidates = swappable
        .filter((e) => !addKinds.some((k) => kindsOf(e.recipeId).has(k)))
        .sort((a, b) => weakness(b) - weakness(a));
    }

    for (const entry of candidates) {
      if ((remaining.get(gap.kind) ?? 0) <= 0) break;
      if (usedEntries.has(entry.id)) continue;
      const from = byId.get(entry.recipeId);
      // Primary pick avoids anything already suggested; alternatives only
      // avoid what's already planned, so "Other ideas" isn't left empty.
      const ranked = rankReplacements(gap, entry.mealType, from, library, proteinsById, plannedRecipeIds, addKinds);
      const best = ranked.find((r) => !usedRecipes.has(r.id)) ?? null;
      usedEntries.add(entry.id);
      remaining.set(gap.kind, (remaining.get(gap.kind) ?? 0) - 1);
      const alsoAdds: ProteinKind[] = [];
      if (best) {
        usedRecipes.add(best.id);
        const gained = kindsOf(best.id);
        for (const k of addKinds) {
          if (k !== gap.kind && gained.has(k)) {
            alsoAdds.push(k);
            remaining.set(k, (remaining.get(k) ?? 0) - 1);
          }
        }
      }
      suggestions.push({
        entryId: entry.id,
        dayOfWeek: entry.dayOfWeek,
        mealType: entry.mealType,
        fromRecipeId: entry.recipeId,
        fromTitle: from?.title ?? "This meal",
        gap,
        toRecipe: best,
        alternatives: ranked.filter((r) => r !== best).slice(0, 3),
        reason: [gapReason(gap), ...alsoAdds.map((k) => `adds ${PROTEIN_LABELS[k].toLowerCase()}`)].join(", "),
      });
    }
  }

  return suggestions.sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  /** Higher = better meal to give up: red/processed meat, then not heart-healthy. */
  function weakness(e: SwapEntry): number {
    const kinds = kindsOf(e.recipeId);
    const r = byId.get(e.recipeId);
    let w = 0;
    if (LIMIT_KINDS.some((k) => kinds.has(k))) w += 2;
    if (r && !isHeartHealthy(r)) w += 1;
    return w;
  }
}
