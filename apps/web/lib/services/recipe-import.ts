/**
 * Importing a recipe that another household shared by link.
 *
 * The share token is the entire authorisation: it names exactly one recipe in
 * exactly one household, and an active token is the owner saying "anyone with
 * this link may have a copy". Nothing here widens that — the importer never
 * gains read access to the source household, only a private duplicate of the
 * one recipe in their own.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import {
  shareTokens,
  households,
  recipes,
  recipeIngredients,
  recipeSteps,
  recipeTags,
} from "@dishes/db/schema";
import { and, eq, asc } from "drizzle-orm";
import { copyFile, isStorageAvailable, keyFromUrl } from "@/lib/storage";
import type { HouseholdContext } from "@/lib/session";
import * as recipeService from "@/lib/services/recipes";

export class ShareLinkInvalidError extends Error {
  constructor() {
    super("This share link is no longer valid.");
    this.name = "ShareLinkInvalidError";
  }
}

export type ImportResult =
  /** A copy now exists in the importer's household. */
  | { status: "imported"; recipeId: string; title: string; sourceName: string }
  /** The link points at a recipe the viewer already owns — nothing to copy. */
  | { status: "own"; recipeId: string; title: string }
  /** They imported this same link before; we send them to the existing copy. */
  | { status: "duplicate"; recipeId: string; title: string };

type TokenRow = {
  recipeId: string;
  householdId: string;
  householdName: string;
  revoked: boolean;
  expiresAt: Date | null;
};

/** Resolve a share token to its recipe, or throw if it is dead. */
async function resolveToken(token: string): Promise<TokenRow> {
  const [row] = await db
    .select({
      recipeId: shareTokens.recipeId,
      householdId: shareTokens.householdId,
      householdName: households.name,
      revoked: shareTokens.revoked,
      expiresAt: shareTokens.expiresAt,
    })
    .from(shareTokens)
    .innerJoin(households, eq(shareTokens.householdId, households.id))
    .where(eq(shareTokens.token, token))
    .limit(1);

  if (!row) throw new ShareLinkInvalidError();
  if (row.revoked) throw new ShareLinkInvalidError();
  if (row.expiresAt && row.expiresAt < new Date()) throw new ShareLinkInvalidError();

  return row;
}

/**
 * Duplicate the source image into the importer's own prefix so the copy
 * survives the original being deleted. Falls back to referencing the existing
 * URL when the image lives outside our storage (or storage is unconfigured) —
 * a shared URL is better than no picture.
 */
async function copyImage(
  imageUrl: string | null,
  thumbnailUrl: string | null,
  householdId: string
): Promise<{ imageUrl: string | null; thumbnailUrl: string | null }> {
  if (!imageUrl || !isStorageAvailable()) return { imageUrl, thumbnailUrl };

  const id = randomUUID();

  async function dupe(url: string | null, suffix: string): Promise<string | null> {
    if (!url) return null;
    const key = keyFromUrl(url);
    if (!key) return url; // not ours — leave the reference as-is
    const ext = key.split(".").pop() ?? "jpg";
    return copyFile(key, `recipes/${householdId}/${id}${suffix}.${ext}`);
  }

  try {
    const [copiedImage, copiedThumb] = await Promise.all([
      dupe(imageUrl, ""),
      dupe(thumbnailUrl, "_thumb"),
    ]);
    return { imageUrl: copiedImage, thumbnailUrl: copiedThumb };
  } catch {
    // A failed copy must not cost the user their import.
    return { imageUrl, thumbnailUrl };
  }
}

export async function importSharedRecipe(
  ctx: HouseholdContext,
  token: string
): Promise<ImportResult> {
  const share = await resolveToken(token);

  const [source] = await db
    .select()
    .from(recipes)
    .where(eq(recipes.id, share.recipeId))
    .limit(1);

  if (!source) throw new ShareLinkInvalidError();

  // Sharing a link back into its own household is a no-op, not a duplicate.
  if (source.householdId === ctx.householdId) {
    return { status: "own", recipeId: source.id, title: source.title };
  }

  // Already imported this recipe — reuse the copy rather than stacking another.
  const [existing] = await db
    .select({ id: recipes.id, title: recipes.title })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, ctx.householdId),
        eq(recipes.importedFromRecipeId, source.id)
      )
    )
    .limit(1);

  if (existing) {
    return { status: "duplicate", recipeId: existing.id, title: existing.title };
  }

  const [ingredients, steps, tags] = await Promise.all([
    db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, source.id))
      .orderBy(asc(recipeIngredients.position)),
    db
      .select()
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, source.id))
      .orderBy(asc(recipeSteps.position)),
    db.select().from(recipeTags).where(eq(recipeTags.recipeId, source.id)),
  ]);

  const images = await copyImage(source.imageUrl, source.thumbnailUrl, ctx.householdId);

  const { recipeId } = await recipeService.createRecipe(ctx, {
    fields: {
      title: source.title,
      description: source.description,
      cuisine: source.cuisine,
      prepTimeMinutes: source.prepTimeMinutes,
      cookTimeMinutes: source.cookTimeMinutes,
      servings: source.servings,
      servingsUnit: source.servingsUnit ?? "servings",
      difficulty: source.difficulty,
      mealTypes: source.mealTypes,
      sourceUrl: source.sourceUrl,
      // Notes are the owner's private annotations — "halve the chilli", "Dad
      // hated this". They are not part of the recipe as far as anyone else is
      // concerned, and the public share page has never displayed them, so they
      // must not ride along in a copy either.
      notes: null,
      imageUrl: images.imageUrl,
      thumbnailUrl: images.thumbnailUrl,
      calories: source.calories,
      proteinG: source.proteinG,
      carbsG: source.carbsG,
      fatG: source.fatG,
      fiberG: source.fiberG,
      sugarG: source.sugarG,
      sodiumMg: source.sodiumMg,
      nutritionSource: source.nutritionSource,
    },
    // The service takes the form-shaped string inputs; nulls become "".
    ingredients: ingredients.map((i) => ({
      ingredientName: i.ingredientName,
      amount: i.amount ?? "",
      unit: i.unit ?? "",
      preparation: i.preparation ?? "",
      isOptional: i.isOptional,
      groupLabel: i.groupLabel ?? "",
    })),
    steps: steps.map((s) => ({
      instruction: s.instruction,
      durationMinutes: s.durationMinutes?.toString() ?? "",
      timerLabel: s.timerLabel ?? "",
      groupLabel: s.groupLabel ?? "",
    })),
    tags: tags.map((t) => t.tag),
    isAiGenerated: source.isAiGenerated,
    importedFrom: { recipeId: source.id, name: share.householdName },
  });

  return {
    status: "imported",
    recipeId,
    title: source.title,
    sourceName: share.householdName,
  };
}
