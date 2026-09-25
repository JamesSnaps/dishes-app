/**
 * Cook history domain logic — shared by server actions
 * (`app/actions/cook-history.ts`) and `app/api/v1/cook-history`.
 *
 * Same rules as the other services: takes a household context, scopes every
 * query by householdId, never redirects or revalidates.
 *
 * The reads here already took an explicit householdId before this extraction,
 * because list pages call them directly. They keep that shape.
 */

import { db } from "@/lib/db";
import { cookHistory, householdMembers, recipes, type MemberRating } from "@dishes/db/schema";
import { eq, and, avg, count, desc, isNotNull } from "drizzle-orm";
import { uploadFile, isStorageAvailable } from "@/lib/storage";
import { makeThumbnail } from "@/lib/thumbnail";
import sharp from "sharp";
import { refreshTasteProfile } from "@/app/actions/taste-profile";
import type { HouseholdContext } from "@/lib/session";
import { ownRating, sameName } from "@/lib/cook-ratings";

export class CookEntryNotFoundError extends Error {
  constructor() {
    super("Cook history record not found");
    this.name = "CookEntryNotFoundError";
  }
}

export class CookHistoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookHistoryValidationError";
  }
}

const RATING_MIN = 0;
const RATING_MAX = 10;

function assertRating(rating: number | null | undefined): void {
  if (rating == null) return;
  if (!Number.isFinite(rating) || rating < RATING_MIN || rating > RATING_MAX) {
    throw new CookHistoryValidationError(
      `rating must be between ${RATING_MIN} and ${RATING_MAX}`
    );
  }
}

/** Returns the entry's recipeId, so callers know what to revalidate. */
async function assertEntryOwned(cookId: string, householdId: string): Promise<string> {
  const [row] = await db
    .select({ recipeId: cookHistory.recipeId })
    .from(cookHistory)
    .where(and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, householdId)))
    .limit(1);

  if (!row) throw new CookEntryNotFoundError();
  return row.recipeId;
}

/** Drop blank names and unrated entries; one rating per person (last wins). */
function cleanMemberRatings(list: MemberRating[] | null | undefined): MemberRating[] | null {
  if (!list) return null;
  const byName = new Map<string, MemberRating>();
  for (const r of list) {
    const name = r.name?.trim();
    if (!name || r.rating == null) continue;
    assertRating(r.rating);
    byName.set(name.toLowerCase(), { name, rating: r.rating });
  }
  return byName.size ? [...byName.values()] : null;
}

/**
 * Everyone's opinion of one cook, with the person saving it as one of the
 * voices: `rating` is their own view (the big stars in the form), and it
 * replaces any entry under their name in `memberRatings`.
 *
 * The entry's stored `rating` is then the household's view — the average of
 * every voice — so the recipe's headline rating, list cards, the AI planner and
 * the taste profile (which all average `rating`) weigh everyone, not just
 * whoever logged the cook. Old entries with no voices keep their single rating.
 */
function combineVoices(
  ownName: string | null,
  own: number | null | undefined,
  others: MemberRating[] | null
): { rating: string | null; memberRatings: MemberRating[] | null } {
  const voices = (others ?? []).filter((r) => !ownName || !sameName(r.name, ownName));
  if (own != null) {
    if (ownName) voices.unshift({ name: ownName, rating: own });
    else if (!voices.length) return { rating: String(own), memberRatings: null };
    else voices.unshift({ name: "Cook", rating: own });
  }
  if (!voices.length) return { rating: null, memberRatings: null };
  const mean = voices.reduce((a, v) => a + v.rating, 0) / voices.length;
  return { rating: String(Math.round(mean * 10) / 10), memberRatings: voices };
}

/** The saving member's display name — their rating is recorded under it. */
async function memberName(ctx: HouseholdContext): Promise<string | null> {
  const [m] = await db
    .select({ displayName: householdMembers.displayName })
    .from(householdMembers)
    .where(and(eq(householdMembers.id, ctx.memberId), eq(householdMembers.householdId, ctx.householdId)))
    .limit(1);
  return m?.displayName ?? null;
}

async function assertRecipeOwned(recipeId: string, householdId: string): Promise<void> {
  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) throw new CookHistoryValidationError("Recipe not found");
}

// --- Types ------------------------------------------------------------------

export type LogCookInput = {
  rating?: number | null;
  actualDuration?: number | null;
  notes?: string | null;
  occasion?: string | null;
  cookedFor?: string[] | null;
  memberRatings?: MemberRating[] | null;
};

/** Everything the end-of-cook review can set, plus clearing the photo. */
export type UpdateCookEntryInput = {
  rating?: number | null;
  actualDuration?: number | null;
  notes?: string | null;
  occasion?: string | null;
  cookedFor?: string[] | null;
  memberRatings?: MemberRating[] | null;
  removePhoto?: boolean;
};

export type CookStats = { cookCount: number; averageRating: number | null };

export type RecipeCookStats = {
  recipeId: string;
  averageRating: number | null;
  cookCount: number;
};

export type CookHistoryEntry = {
  id: string;
  /** ISO string — safe to pass to client components */
  cookedAt: string;
  rating: number | null;
  actualDuration: number | null;
  notes: string | null;
  occasion: string | null;
  cookedFor: string[] | null;
  memberRatings: MemberRating[] | null;
  photoUrl: string | null;
  /** 'cook' = a cook was logged; 'rating' = rated without cooking */
  source: string;
};

// --- Writes -----------------------------------------------------------------

export async function logCook(
  ctx: HouseholdContext,
  recipeId: string,
  data: LogCookInput
): Promise<{ id: string; recipeId: string }> {
  assertRating(data.rating);
  await assertRecipeOwned(recipeId, ctx.householdId);
  const voices = combineVoices(await memberName(ctx), data.rating, cleanMemberRatings(data.memberRatings));

  const [row] = await db
    .insert(cookHistory)
    .values({
      householdId: ctx.householdId,
      recipeId,
      rating: voices.rating,
      actualDuration: data.actualDuration ?? null,
      notes: data.notes?.trim() || null,
      occasion: data.occasion?.trim() || null,
      cookedFor: data.cookedFor?.length ? data.cookedFor : null,
      memberRatings: voices.memberRatings,
    })
    .returning({ id: cookHistory.id });

  void refreshTasteProfile(ctx.householdId);
  return { id: row!.id, recipeId };
}

export async function rateCook(
  ctx: HouseholdContext,
  cookId: string,
  rating: number
): Promise<{ recipeId: string }> {
  assertRating(rating);
  const recipeId = await assertEntryOwned(cookId, ctx.householdId);
  const [existing] = await db
    .select({ memberRatings: cookHistory.memberRatings })
    .from(cookHistory)
    .where(eq(cookHistory.id, cookId));
  // Only the caller's own voice changes; everyone else's opinion stays.
  const voices = combineVoices(await memberName(ctx), rating, existing?.memberRatings ?? null);

  await db
    .update(cookHistory)
    .set(voices)
    .where(
      and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, ctx.householdId))
    );

  void refreshTasteProfile(ctx.householdId);
  return { recipeId };
}

/**
 * A rating given without cooking. Recorded as source 'rating' so it contributes
 * to the average but not to "cooked N times".
 */
export async function rateRecipe(
  ctx: HouseholdContext,
  recipeId: string,
  rating: number,
  notes?: string
): Promise<{ id: string }> {
  assertRating(rating);
  await assertRecipeOwned(recipeId, ctx.householdId);

  const [row] = await db
    .insert(cookHistory)
    .values({
      householdId: ctx.householdId,
      recipeId,
      ...combineVoices(await memberName(ctx), rating, null),
      notes: notes?.trim() || null,
      source: "rating",
    })
    .returning({ id: cookHistory.id });

  void refreshTasteProfile(ctx.householdId);
  return { id: row!.id };
}

export async function updateCookEntry(
  ctx: HouseholdContext,
  cookId: string,
  data: UpdateCookEntryInput
): Promise<{ recipeId: string }> {
  assertRating(data.rating);
  const recipeId = await assertEntryOwned(cookId, ctx.householdId);
  // Ratings are rebuilt from the caller's own rating plus everyone else's.
  // Either half may be omitted; the missing half comes from what's stored.
  let voices: ReturnType<typeof combineVoices> | undefined;
  if (data.rating !== undefined || data.memberRatings !== undefined) {
    const [existing] = await db
      .select({ rating: cookHistory.rating, memberRatings: cookHistory.memberRatings })
      .from(cookHistory)
      .where(eq(cookHistory.id, cookId));
    const name = await memberName(ctx);
    const stored = ownRating(
      { rating: existing?.rating != null ? Number(existing.rating) : null, memberRatings: existing?.memberRatings ?? null },
      name
    );
    voices = combineVoices(
      name,
      data.rating !== undefined ? data.rating : stored.own,
      data.memberRatings !== undefined ? cleanMemberRatings(data.memberRatings) : stored.others
    );
  }

  await db
    .update(cookHistory)
    .set({
      ...(voices ?? {}),
      ...(data.actualDuration !== undefined
        ? { actualDuration: data.actualDuration && data.actualDuration > 0 ? data.actualDuration : null }
        : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
      ...(data.occasion !== undefined
        ? { occasion: data.occasion?.trim() || null }
        : {}),
      ...(data.cookedFor !== undefined
        ? { cookedFor: data.cookedFor?.length ? data.cookedFor : null }
        : {}),
      ...(data.removePhoto ? { photoUrl: null } : {}),
    })
    .where(
      and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, ctx.householdId))
    );

  void refreshTasteProfile(ctx.householdId);
  return { recipeId };
}

/**
 * Remove a single entry — for duplicates or a mis-logged cook. Also removes its
 * rating from the recipe average.
 */
export async function deleteCookEntry(
  ctx: HouseholdContext,
  cookId: string
): Promise<{ recipeId: string }> {
  const recipeId = await assertEntryOwned(cookId, ctx.householdId);

  await db
    .delete(cookHistory)
    .where(
      and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, ctx.householdId))
    );

  void refreshTasteProfile(ctx.householdId);
  return { recipeId };
}

// --- Reads ------------------------------------------------------------------

/**
 * The average rating spans every entry, but only actual cooks count as cooks —
 * rating a recipe you haven't made shouldn't say you cooked it.
 */
export async function getCookStats(
  householdId: string,
  recipeId: string
): Promise<CookStats> {
  const scope = and(
    eq(cookHistory.recipeId, recipeId),
    eq(cookHistory.householdId, householdId)
  );

  const [ratingRow, cookRow] = await Promise.all([
    db
      .select({ averageRating: avg(cookHistory.rating) })
      .from(cookHistory)
      .where(scope)
      .then((r) => r[0]),
    db
      .select({ cookCount: count(cookHistory.id) })
      .from(cookHistory)
      .where(and(scope, eq(cookHistory.source, "cook")))
      .then((r) => r[0]),
  ]);

  const rawAvg = ratingRow?.averageRating;
  return {
    cookCount: Number(cookRow?.cookCount ?? 0),
    averageRating: rawAvg != null ? Math.round(parseFloat(rawAvg) * 10) / 10 : null,
  };
}

/** Per-recipe stats for list pages. Same rule as getCookStats. */
export async function getCookStatsByRecipe(
  householdId: string
): Promise<RecipeCookStats[]> {
  const [ratingRows, cookRows] = await Promise.all([
    db
      .select({ recipeId: cookHistory.recipeId, averageRating: avg(cookHistory.rating) })
      .from(cookHistory)
      .where(eq(cookHistory.householdId, householdId))
      .groupBy(cookHistory.recipeId),
    db
      .select({ recipeId: cookHistory.recipeId, cookCount: count(cookHistory.id) })
      .from(cookHistory)
      .where(
        and(
          eq(cookHistory.householdId, householdId),
          eq(cookHistory.source, "cook")
        )
      )
      .groupBy(cookHistory.recipeId),
  ]);

  const counts = new Map(cookRows.map((r) => [r.recipeId, Number(r.cookCount)]));
  return ratingRows.map((r) => ({
    recipeId: r.recipeId,
    averageRating:
      r.averageRating != null ? Math.round(parseFloat(r.averageRating) * 10) / 10 : null,
    cookCount: counts.get(r.recipeId) ?? 0,
  }));
}

/** Null until there are at least two timed cooks — one is not a pattern. */
export async function getAverageDuration(
  householdId: string,
  recipeId: string
): Promise<number | null> {
  const [row] = await db
    .select({
      avgDuration: avg(cookHistory.actualDuration),
      cookCount: count(cookHistory.id),
    })
    .from(cookHistory)
    .where(
      and(
        eq(cookHistory.recipeId, recipeId),
        eq(cookHistory.householdId, householdId),
        isNotNull(cookHistory.actualDuration)
      )
    );

  if (!row || Number(row.cookCount) < 2 || !row.avgDuration) return null;
  return Math.round(parseFloat(row.avgDuration));
}

export async function getRecipeCookHistory(
  householdId: string,
  recipeId: string
): Promise<CookHistoryEntry[]> {
  const rows = await db
    .select({
      id: cookHistory.id,
      cookedAt: cookHistory.cookedAt,
      rating: cookHistory.rating,
      actualDuration: cookHistory.actualDuration,
      notes: cookHistory.notes,
      occasion: cookHistory.occasion,
      cookedFor: cookHistory.cookedFor,
      memberRatings: cookHistory.memberRatings,
      photoUrl: cookHistory.photoUrl,
      source: cookHistory.source,
    })
    .from(cookHistory)
    .where(
      and(
        eq(cookHistory.recipeId, recipeId),
        eq(cookHistory.householdId, householdId)
      )
    )
    .orderBy(desc(cookHistory.cookedAt));

  return rows.map((r) => ({
    ...r,
    cookedAt: r.cookedAt.toISOString(),
    rating: r.rating != null ? parseFloat(r.rating) : null,
  }));
}

// --- Photo ------------------------------------------------------------------

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Store a dish photo against a cook entry. Takes raw bytes rather than a File
 * so both a multipart form post and a native client's upload can use it.
 */
export async function setCookPhoto(
  ctx: HouseholdContext,
  cookId: string,
  raw: Buffer,
  contentType: string
): Promise<{ url: string; recipeId: string }> {
  if (!isStorageAvailable()) {
    throw new CookHistoryValidationError("Storage not configured.");
  }
  if (!PHOTO_TYPES.includes(contentType)) {
    throw new CookHistoryValidationError(
      "Only JPEG, PNG, and WebP images are allowed."
    );
  }
  if (raw.byteLength > PHOTO_MAX_BYTES) {
    throw new CookHistoryValidationError("Photo must be under 15 MB.");
  }

  const recipeId = await assertEntryOwned(cookId, ctx.householdId);

  // Resize to max 1600px wide and convert to JPEG before storing.
  const resized = await sharp(raw)
    .rotate() // auto-rotate from EXIF orientation, then strip the tag
    .resize(1600, null, { withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  const base = `households/${ctx.householdId}/cook-history/${cookId}`;

  const [url] = await Promise.all([
    uploadFile(`${base}/dish.jpg`, resized, "image/jpeg"),
    makeThumbnail(raw)
      .then((thumb) => uploadFile(`${base}/dish_thumb.jpg`, thumb, "image/jpeg"))
      .catch(() => null),
  ]);

  await db
    .update(cookHistory)
    .set({ photoUrl: url })
    .where(
      and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, ctx.householdId))
    );

  return { url, recipeId };
}
