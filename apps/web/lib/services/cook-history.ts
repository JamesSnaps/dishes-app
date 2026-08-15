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
import { cookHistory, recipes } from "@dishes/db/schema";
import { eq, and, avg, count, desc, isNotNull } from "drizzle-orm";
import { uploadFile, isStorageAvailable } from "@/lib/storage";
import { makeThumbnail } from "@/lib/thumbnail";
import sharp from "sharp";
import { refreshTasteProfile } from "@/app/actions/taste-profile";
import type { HouseholdContext } from "@/lib/session";

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
};

export type UpdateCookEntryInput = {
  rating?: number | null;
  notes?: string | null;
  occasion?: string | null;
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

  const [row] = await db
    .insert(cookHistory)
    .values({
      householdId: ctx.householdId,
      recipeId,
      rating: data.rating != null ? String(data.rating) : null,
      actualDuration: data.actualDuration ?? null,
      notes: data.notes?.trim() || null,
      occasion: data.occasion?.trim() || null,
      cookedFor: data.cookedFor?.length ? data.cookedFor : null,
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

  await db
    .update(cookHistory)
    .set({ rating: String(rating) })
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
      rating: String(rating),
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

  await db
    .update(cookHistory)
    .set({
      ...(data.rating !== undefined
        ? { rating: data.rating != null ? String(data.rating) : null }
        : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
      ...(data.occasion !== undefined
        ? { occasion: data.occasion?.trim() || null }
        : {}),
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
