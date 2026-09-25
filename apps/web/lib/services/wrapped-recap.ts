/**
 * The AI-written "your year in your own words" recap for Wrapped, built from
 * the year's cook review notes. Generated on request (it costs tokens and takes
 * a few seconds) and cached in Redis per household and year, so replaying
 * Wrapped doesn't pay for it again. No Redis → no cache, still works.
 */

import { db } from "@/lib/db";
import { cookHistory, recipes } from "@dishes/db/schema";
import { and, eq, gte, isNotNull, lt } from "drizzle-orm";
import { getRedis } from "@/lib/redis";

const TTL_SECONDS = 60 * 60 * 24 * 400; // outlives the year it's about
const key = (householdId: string, year: number) => `wrapped:recap:${householdId}:${year}`;

export async function getCachedRecap(householdId: string, year: number): Promise<string | null> {
  try {
    return (await getRedis()?.get(key(householdId, year))) ?? null;
  } catch {
    return null;
  }
}

export async function cacheRecap(householdId: string, year: number, text: string): Promise<void> {
  try {
    await getRedis()?.set(key(householdId, year), text, "EX", TTL_SECONDS);
  } catch {
    // Cache is best-effort.
  }
}

/** The year's reviews as prompt lines, oldest first, capped to keep the prompt small. */
export async function recapSourceLines(householdId: string, year: number, limit = 80): Promise<string[]> {
  const rows = await db
    .select({
      cookedAt: cookHistory.cookedAt,
      title: recipes.title,
      rating: cookHistory.rating,
      notes: cookHistory.notes,
      occasion: cookHistory.occasion,
      memberRatings: cookHistory.memberRatings,
    })
    .from(cookHistory)
    .innerJoin(recipes, eq(cookHistory.recipeId, recipes.id))
    .where(
      and(
        eq(cookHistory.householdId, householdId),
        isNotNull(cookHistory.notes),
        gte(cookHistory.cookedAt, new Date(`${year}-01-01T00:00:00Z`)),
        lt(cookHistory.cookedAt, new Date(`${year + 1}-01-01T00:00:00Z`))
      )
    )
    .orderBy(cookHistory.cookedAt);

  const withNotes = rows.filter((r) => r.notes?.trim());
  // Evenly sample when there are more than we can send.
  const step = Math.max(1, withNotes.length / limit);
  const picked = withNotes.length > limit ? Array.from({ length: limit }, (_, i) => withNotes[Math.floor(i * step)]!) : withNotes;

  return picked.map((r) => {
    const bits = [r.cookedAt.toISOString().slice(0, 10), `"${r.title}"`];
    if (r.rating != null) bits.push(`${Number(r.rating) / 2}/5`);
    if (r.occasion) bits.push(`(${r.occasion})`);
    if (r.memberRatings?.length) bits.push(r.memberRatings.map((m) => `${m.name} ${m.rating / 2}/5`).join(", "));
    return `- ${bits.join(" ")}: ${r.notes!.trim().replace(/\s+/g, " ").slice(0, 240)}`;
  });
}
