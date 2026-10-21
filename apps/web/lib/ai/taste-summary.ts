/**
 * What the AI prompts say about a household's taste, from its taste profile
 * (`lib/services/taste-profile.ts`). Pure, so `scripts/check-ai-context.ts`
 * can check it without a database.
 */

// ── summariseTasteProfile ─────────────────────────────────────────────────────

/** The part of the profile the AI prompts use. Below this many rated cooks it's noise. */
export const TASTE_PROFILE_MIN_RATED_COOKS = 10;

export type TasteProfileSummary = {
  ratedCookCount: number;
  /** Top five, best first, with their 1–5 score. */
  preferredCuisines: Array<{ name: string; score: number }>;
  lovedIngredients: string[];
  dislikedIngredients: string[];
};

/**
 * What the AI prompts say about the household's taste. Shared by the server's
 * prompts (`app/actions/ai.ts`) and `GET /api/v1/ai/context`, so the iOS app's
 * on-device prompts get exactly the same lists. null until there are enough
 * rated cooks to mean anything.
 */
export function summariseTasteProfile(
  profile: { cuisines: Record<string, number>; ingredients: Record<string, number>; ratedCookCount: number } | null
): TasteProfileSummary | null {
  if (!profile || profile.ratedCookCount < TASTE_PROFILE_MIN_RATED_COOKS) return null;

  const preferredCuisines = Object.entries(profile.cuisines)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, score]) => ({ name, score }));

  const lovedIngredients = Object.entries(profile.ingredients)
    .filter(([, s]) => s >= 3.0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name]) => name);

  const dislikedIngredients = Object.entries(profile.ingredients)
    .filter(([, s]) => s <= 1.5)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 5)
    .map(([name]) => name);

  return { ratedCookCount: profile.ratedCookCount, preferredCuisines, lovedIngredients, dislikedIngredients };
}
