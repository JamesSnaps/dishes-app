/**
 * Copying a recipe someone else has shared into your own household.
 *
 * Two sources, one copy engine:
 *   - a public share token (an anonymous link to a single recipe)
 *   - a library share (a live grant between two households on this instance)
 *
 * Authorisation and copying are deliberately separate. `authoriseImport`
 * decides what may be copied and returns the source rows; `copyRecipesInto`
 * does the copying and asks no questions. Nothing copies without an
 * `ImportSource`, and the library-share branch delegates its entire decision to
 * `library-share-scope.ts` rather than re-deriving the rule — see that module's
 * header for why that matters.
 *
 * The copy is a snapshot, not a link: the importer owns it outright and the
 * original is untouched. What it does NOT carry is the owner's private notes.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import {
  collections,
  households,
  libraryShareImports,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  recipes,
  shareTokens,
} from "@dishes/db/schema";
import { and, eq, inArray, asc } from "drizzle-orm";
import { copyFile, isStorageAvailable, keyFromUrl } from "@/lib/storage";
import type { HouseholdContext, PrivilegedContext } from "@/lib/session";
import * as recipeService from "@/lib/services/recipes";
import {
  assertRecipesInScope,
  loadShareScope,
  LibraryShareInvalidError,
} from "@/lib/services/library-share-scope";

export class ShareLinkInvalidError extends Error {
  constructor() {
    super("This share link is no longer valid.");
    this.name = "ShareLinkInvalidError";
  }
}

export class ImportForbiddenError extends Error {
  constructor() {
    super("Only adults and admins can add recipes to the household.");
    this.name = "ImportForbiddenError";
  }
}

export type ImportResult =
  /** A copy now exists in the importer's household. */
  | { status: "imported"; recipeId: string; title: string; sourceName: string }
  /** The source is a recipe the viewer already owns — nothing to copy. */
  | { status: "own"; recipeId: string; title: string }
  /** They imported this same recipe before; we point at the existing copy. */
  | { status: "duplicate"; recipeId: string; title: string }
  /** One item of a batch failed; the rest still went through. */
  | { status: "failed"; sourceRecipeId: string; title: string; reason: string };

export type BatchImportResult = {
  results: ImportResult[];
  imported: number;
  skipped: number;
  failed: number;
  /** The collection the copies were filed into, when more than one was taken. */
  collectionId: string | null;
  collectionName: string | null;
};

type SourceRecipe = typeof recipes.$inferSelect;

/** Where the right to copy came from. Nothing copies without one of these. */
type ImportSource =
  | { kind: "public-token"; sourceName: string }
  | { kind: "library-share"; shareId: string; sourceName: string };

// --- Authorisation ----------------------------------------------------------

export type ImportRequest =
  | { kind: "public-token"; token: string }
  | { kind: "library-share"; shareId: string; recipeIds: string[] };

/**
 * Decide what may be copied, and return the source rows so the caller doesn't
 * fetch them twice. Throws rather than filtering silently — a request naming
 * something out of scope is a bug or an attack, not a partial success.
 */
export async function authoriseImport(
  ctx: HouseholdContext,
  request: ImportRequest
): Promise<{ source: ImportSource; rows: SourceRecipe[] }> {
  if (request.kind === "public-token") {
    const [token] = await db
      .select({
        recipeId: shareTokens.recipeId,
        householdName: households.name,
        revoked: shareTokens.revoked,
        expiresAt: shareTokens.expiresAt,
      })
      .from(shareTokens)
      .innerJoin(households, eq(shareTokens.householdId, households.id))
      .where(eq(shareTokens.token, request.token))
      .limit(1);

    if (!token || token.revoked) throw new ShareLinkInvalidError();
    if (token.expiresAt && token.expiresAt < new Date()) throw new ShareLinkInvalidError();

    const [row] = await db.select().from(recipes).where(eq(recipes.id, token.recipeId)).limit(1);
    if (!row) throw new ShareLinkInvalidError();

    return {
      source: { kind: "public-token", sourceName: token.householdName },
      rows: [row],
    };
  }

  const scope = await loadShareScope(ctx.householdId, request.shareId);
  const rows = await assertRecipesInScope(scope, request.recipeIds);

  return {
    source: {
      kind: "library-share",
      shareId: request.shareId,
      sourceName: scope.ownerHouseholdName,
    },
    rows,
  };
}

// --- Copying ----------------------------------------------------------------

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
  } catch (err) {
    // A failed copy must not cost the user their import, but a silent fallback
    // means the copy quietly depends on the original's object surviving.
    console.warn("[import] image copy failed, referencing the original:", err);
    return { imageUrl, thumbnailUrl };
  }
}

/** Run promises with a ceiling on how many are in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    })
  );
  return results;
}

function buildWriteInput(
  source: SourceRecipe,
  images: { imageUrl: string | null; thumbnailUrl: string | null },
  children: {
    ingredients: (typeof recipeIngredients.$inferSelect)[];
    steps: (typeof recipeSteps.$inferSelect)[];
    tags: string[];
  },
  sourceName: string,
  collectionId: string | null
): recipeService.RecipeWriteInput {
  return {
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
      // concerned, and never travel with a copy.
      notes: null,
      imageUrl: images.imageUrl,
      thumbnailUrl: images.thumbnailUrl,
      calories: source.calories,
      proteinG: source.proteinG,
      carbsG: source.carbsG,
      fatG: source.fatG,
      saturatedFatG: source.saturatedFatG,
      fiberG: source.fiberG,
      sugarG: source.sugarG,
      sodiumMg: source.sodiumMg,
      nutritionSource: source.nutritionSource,
    },
    // The service takes the form-shaped string inputs; nulls become "".
    ingredients: children.ingredients.map((i) => ({
      ingredientName: i.ingredientName,
      amount: i.amount ?? "",
      unit: i.unit ?? "",
      preparation: i.preparation ?? "",
      isOptional: i.isOptional,
      groupLabel: i.groupLabel ?? "",
    })),
    steps: children.steps.map((s) => ({
      instruction: s.instruction,
      durationMinutes: s.durationMinutes?.toString() ?? "",
      timerLabel: s.timerLabel ?? "",
      groupLabel: s.groupLabel ?? "",
    })),
    tags: children.tags,
    collectionId,
    isAiGenerated: source.isAiGenerated,
    importedFrom: { recipeId: source.id, name: sourceName },
  };
}

/**
 * Copy source rows into the importer's household. Assumes authorisation has
 * already happened — this is not exported, and every public entry point above
 * it goes through `authoriseImport` first.
 *
 * Batched throughout: one duplicate check, one fetch per child table, capped
 * concurrent image copies, and a single transaction for the writes.
 */
async function copyRecipesInto(
  ctx: HouseholdContext,
  rows: SourceRecipe[],
  source: ImportSource,
  collectionId: string | null
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];

  // Sharing a link back into its own household is a no-op, not a duplicate.
  const foreign = rows.filter((r) => {
    if (r.householdId === ctx.householdId) {
      results.push({ status: "own", recipeId: r.id, title: r.title });
      return false;
    }
    return true;
  });

  if (foreign.length === 0) return results;

  const sourceIds = foreign.map((r) => r.id);

  // Already imported? One query for the whole batch, using the partial index
  // added in migration 0029.
  const existing = await db
    .select({ id: recipes.id, title: recipes.title, from: recipes.importedFromRecipeId })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, ctx.householdId),
        inArray(recipes.importedFromRecipeId, sourceIds)
      )
    );

  const alreadyImported = new Map(existing.map((e) => [e.from!, e]));
  const toCopy = foreign.filter((r) => {
    const dupe = alreadyImported.get(r.id);
    if (dupe) {
      results.push({ status: "duplicate", recipeId: dupe.id, title: dupe.title });
      return false;
    }
    return true;
  });

  if (toCopy.length === 0) return results;

  const copyIds = toCopy.map((r) => r.id);

  const [ingredients, steps, tags, images] = await Promise.all([
    db
      .select()
      .from(recipeIngredients)
      .where(inArray(recipeIngredients.recipeId, copyIds))
      .orderBy(asc(recipeIngredients.position)),
    db
      .select()
      .from(recipeSteps)
      .where(inArray(recipeSteps.recipeId, copyIds))
      .orderBy(asc(recipeSteps.position)),
    db.select().from(recipeTags).where(inArray(recipeTags.recipeId, copyIds)),
    // Capped so a forty-recipe import doesn't hammer object storage.
    mapWithConcurrency(toCopy, 5, (r) =>
      copyImage(r.imageUrl, r.thumbnailUrl, ctx.householdId)
    ),
  ]);

  const byRecipe = <T extends { recipeId: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of list) {
      const bucket = map.get(row.recipeId);
      if (bucket) bucket.push(row);
      else map.set(row.recipeId, [row]);
    }
    return map;
  };

  const ingredientsBy = byRecipe(ingredients);
  const stepsBy = byRecipe(steps);
  const tagsBy = byRecipe(tags);

  await db.transaction(async (tx) => {
    for (const [i, sourceRow] of toCopy.entries()) {
      const input = buildWriteInput(
        sourceRow,
        images[i]!,
        {
          ingredients: ingredientsBy.get(sourceRow.id) ?? [],
          steps: stepsBy.get(sourceRow.id) ?? [],
          tags: (tagsBy.get(sourceRow.id) ?? []).map((t) => t.tag),
        },
        source.sourceName,
        collectionId
      );

      const { recipeId } = await recipeService.createRecipe(ctx, input, tx);

      if (source.kind === "library-share") {
        await tx.insert(libraryShareImports).values({
          shareId: source.shareId,
          sourceRecipeId: sourceRow.id,
          copyRecipeId: recipeId,
          granteeHouseholdId: ctx.householdId,
        });
      }

      results.push({
        status: "imported",
        recipeId,
        title: sourceRow.title,
        sourceName: source.sourceName,
      });
    }
  });

  return results;
}

// --- Public entry points ----------------------------------------------------

/** Import the single recipe behind a public share link. */
export async function importSharedRecipe(
  ctx: HouseholdContext,
  token: string
): Promise<ImportResult> {
  const { source, rows } = await authoriseImport(ctx, { kind: "public-token", token });
  const [result] = await copyRecipesInto(ctx, rows, source, null);
  if (!result) throw new ShareLinkInvalidError();
  return result;
}

/**
 * Import one or more recipes from a shared library.
 *
 * A multi-recipe import lands in its own collection named after the source, so
 * eight recipes don't scatter through the importer's library with no way back
 * to them. A single recipe goes in loose — a collection of one is clutter.
 */
export async function importFromLibraryShare(
  ctx: PrivilegedContext,
  shareId: string,
  recipeIds: string[]
): Promise<BatchImportResult> {
  if (ctx.role === "child") throw new ImportForbiddenError();
  if (recipeIds.length === 0) throw new LibraryShareInvalidError();

  const { source, rows } = await authoriseImport(ctx, {
    kind: "library-share",
    shareId,
    recipeIds,
  });

  let collectionId: string | null = null;
  let collectionName: string | null = null;
  if (rows.length > 1) {
    const created = await ensureImportCollection(ctx, source.sourceName);
    collectionId = created.id;
    collectionName = created.name;
  }

  const results = await copyRecipesInto(ctx, rows, source, collectionId);

  const imported = results.filter((r) => r.status === "imported").length;

  return {
    results,
    imported,
    skipped: results.filter((r) => r.status === "duplicate" || r.status === "own").length,
    failed: results.filter((r) => r.status === "failed").length,
    // Report the collection only if something actually landed in it.
    collectionId: imported > 0 ? collectionId : null,
    collectionName: imported > 0 ? collectionName : null,
  };
}

/** "From Jane's Kitchen" — reused across imports from the same source. */
async function ensureImportCollection(
  ctx: HouseholdContext,
  sourceName: string
): Promise<{ id: string; name: string }> {
  const name = `From ${sourceName}`;

  const [existing] = await db
    .select({ id: collections.id, name: collections.name })
    .from(collections)
    .where(and(eq(collections.householdId, ctx.householdId), eq(collections.name, name)))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(collections)
    .values({ householdId: ctx.householdId, name, icon: "📥" })
    .returning({ id: collections.id, name: collections.name });

  return created!;
}
