/**
 * Per-person cook ratings — pure helpers shared by the server (cook history
 * service) and client components (review form, recipe page breakdown).
 * Ratings are 0–10, like cook_history.rating.
 */

import type { MemberRating } from "@dishes/db/schema";

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Split a stored entry back into "your rating" and everyone else's, for editing. */
export function ownRating(
  entry: { rating: number | null; memberRatings: MemberRating[] | null },
  ownName: string | null
): { own: number | null; others: MemberRating[] } {
  const voices = entry.memberRatings ?? [];
  if (!voices.length) return { own: entry.rating, others: [] };
  const mine = ownName ? voices.find((v) => sameName(v.name, ownName)) : undefined;
  return { own: mine?.rating ?? null, others: voices.filter((v) => v !== mine) };
}

export type PersonRating = { name: string; average: number; count: number };

/** Each person's average rating of a recipe across its entries (0–10). */
export function ratingsByPerson(entries: { memberRatings: MemberRating[] | null }[]): PersonRating[] {
  const acc = new Map<string, { name: string; sum: number; n: number }>();
  for (const e of entries) {
    for (const v of e.memberRatings ?? []) {
      const key = v.name.trim().toLowerCase();
      const a = acc.get(key) ?? { name: v.name, sum: 0, n: 0 };
      a.sum += v.rating;
      a.n += 1;
      acc.set(key, a);
    }
  }
  return [...acc.values()]
    .map((a) => ({ name: a.name, average: Math.round((a.sum / a.n) * 10) / 10, count: a.n }))
    .sort((x, y) => y.average - x.average || x.name.localeCompare(y.name));
}

