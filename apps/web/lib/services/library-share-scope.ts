/**
 * The scope of a library share, and the one predicate that enforces it.
 *
 * This module is the single source of truth for "which of the owner's recipes
 * does this share expose". Browsing and importing MUST both go through
 * `shareScopePredicate` — importing is not allowed to re-derive the rule, or
 * the two will drift and an import will eventually be able to copy something
 * the browse view would never have shown.
 *
 * Two rules that are deliberate and must not be softened:
 *
 *   1. Exclude always wins. The exclude-tags clause is AND-ed last and is not
 *      conditional on the base selector, so a recipe in a shared collection
 *      that also carries an excluded tag stays hidden. "Excluded" has to be a
 *      guarantee, or it is not worth offering.
 *
 *   2. An empty include selector exposes nothing, not everything. If an owner
 *      picks "these collections" and then deletes the last one, failing open
 *      would silently share their entire library. Fail closed.
 *
 * This is the one place in the codebase that reads another household's rows,
 * so the owner-household anchor lives inside the predicate rather than being
 * left to the caller.
 */

import { db } from "@/lib/db";
import {
  collections,
  households,
  libraryShareCollections,
  libraryShareTags,
  libraryShares,
  recipeCollections,
  recipeTags,
  recipes,
} from "@dishes/db/schema";
import { and, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";

/** Share absent, not yours, or no longer live — indistinguishable on purpose. */
export class LibraryShareInvalidError extends Error {
  constructor() {
    super("This shared library is no longer available.");
    this.name = "LibraryShareInvalidError";
  }
}

export type ShareBaseScope = "all" | "collections" | "tags";

export type ShareScope = {
  shareId: string;
  ownerHouseholdId: string;
  ownerHouseholdName: string;
  baseScope: ShareBaseScope;
  includeCollectionIds: string[];
  includeTags: string[];
  excludeTags: string[];
};

/**
 * Load the scope of a live grant, from the grantee's point of view.
 *
 * Throws rather than returning a status: every caller of this is about to read
 * another household's data, and the only safe response to "not live" is no.
 */
export async function loadShareScope(
  granteeHouseholdId: string,
  shareId: string
): Promise<ShareScope> {
  const [share] = await db
    .select({
      id: libraryShares.id,
      ownerHouseholdId: libraryShares.ownerHouseholdId,
      baseScope: libraryShares.baseScope,
      excludeTags: libraryShares.excludeTags,
    })
    .from(libraryShares)
    .where(
      and(
        eq(libraryShares.id, shareId),
        eq(libraryShares.granteeHouseholdId, granteeHouseholdId),
        isNull(libraryShares.revokedByOwnerAt),
        isNull(libraryShares.revokedByGranteeAt)
      )
    )
    .limit(1);

  if (!share) throw new LibraryShareInvalidError();

  return loadScopeForShareRow(share.id, share.ownerHouseholdId, share.baseScope, share.excludeTags);
}

/**
 * The owner's own view of a scope — used by the scope editor's live count and
 * by the invite preview, neither of which has a grantee to check against.
 * Callers are responsible for having established that the share is the
 * owner's; this does not check.
 */
export async function loadShareScopeAsOwner(
  ownerHouseholdId: string,
  shareId: string
): Promise<ShareScope> {
  const [share] = await db
    .select({
      id: libraryShares.id,
      ownerHouseholdId: libraryShares.ownerHouseholdId,
      baseScope: libraryShares.baseScope,
      excludeTags: libraryShares.excludeTags,
    })
    .from(libraryShares)
    .where(
      and(eq(libraryShares.id, shareId), eq(libraryShares.ownerHouseholdId, ownerHouseholdId))
    )
    .limit(1);

  if (!share) throw new LibraryShareInvalidError();

  return loadScopeForShareRow(share.id, share.ownerHouseholdId, share.baseScope, share.excludeTags);
}

async function loadScopeForShareRow(
  shareId: string,
  ownerHouseholdId: string,
  baseScope: ShareBaseScope,
  excludeTags: string[]
): Promise<ShareScope> {
  const [includeCollections, includeTags, [owner]] = await Promise.all([
    db
      .select({ collectionId: libraryShareCollections.collectionId })
      .from(libraryShareCollections)
      .where(eq(libraryShareCollections.shareId, shareId)),
    db
      .select({ tag: libraryShareTags.tag })
      .from(libraryShareTags)
      .where(eq(libraryShareTags.shareId, shareId)),
    db
      .select({ name: households.name })
      .from(households)
      .where(eq(households.id, ownerHouseholdId))
      .limit(1),
  ]);

  return {
    shareId,
    ownerHouseholdId,
    ownerHouseholdName: owner?.name ?? "another household",
    baseScope,
    includeCollectionIds: includeCollections.map((c) => c.collectionId),
    includeTags: includeTags.map((t) => t.tag),
    excludeTags: excludeTags ?? [],
  };
}

/**
 * The condition matching exactly the recipes this share exposes.
 *
 * Always anchored to the owner's household, so it cannot be used to reach
 * anything else even by mistake.
 */
export function shareScopePredicate(scope: ShareScope): SQL {
  const conditions: SQL[] = [eq(recipes.householdId, scope.ownerHouseholdId)];

  if (scope.baseScope === "collections") {
    // Fail closed — see rule 2 in the module header.
    if (scope.includeCollectionIds.length === 0) return sql`false`;
    conditions.push(
      inArray(
        recipes.id,
        db
          .select({ id: recipeCollections.recipeId })
          .from(recipeCollections)
          .innerJoin(collections, eq(collections.id, recipeCollections.collectionId))
          .where(
            and(
              inArray(recipeCollections.collectionId, scope.includeCollectionIds),
              // Belt and braces: a collection can only widen the owner's own scope.
              eq(collections.householdId, scope.ownerHouseholdId)
            )
          )
      )
    );
  } else if (scope.baseScope === "tags") {
    if (scope.includeTags.length === 0) return sql`false`;
    conditions.push(
      inArray(
        recipes.id,
        db
          .select({ id: recipeTags.recipeId })
          .from(recipeTags)
          .where(inArray(recipeTags.tag, scope.includeTags))
      )
    );
  }
  // "all" adds nothing beyond the household anchor.

  // Last, and unconditional — see rule 1.
  if (scope.excludeTags.length > 0) {
    conditions.push(
      notInArray(
        recipes.id,
        db
          .select({ id: recipeTags.recipeId })
          .from(recipeTags)
          .where(inArray(recipeTags.tag, scope.excludeTags))
      )
    );
  }

  return and(...conditions)!;
}

/**
 * Authorisation for copying out of a shared library.
 *
 * Not a reimplementation of the browse rule — a *use* of it. Returns the
 * source rows so the caller doesn't have to fetch them again, and throws
 * unless every requested id is genuinely in scope.
 */
export async function assertRecipesInScope(scope: ShareScope, recipeIds: string[]) {
  const wanted = [...new Set(recipeIds)];
  if (wanted.length === 0) return [];

  const rows = await db
    .select()
    .from(recipes)
    .where(and(shareScopePredicate(scope), inArray(recipes.id, wanted)));

  if (rows.length !== wanted.length) throw new LibraryShareInvalidError();
  return rows;
}

/** How many recipes a scope currently exposes. Drives the owner's live count. */
export async function countRecipesInScope(scope: ShareScope): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(recipes)
    .where(shareScopePredicate(scope));
  return row?.value ?? 0;
}
