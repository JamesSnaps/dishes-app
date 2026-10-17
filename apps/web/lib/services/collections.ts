import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { collections, recipeCollections, recipes } from "@dishes/db/schema";
import type { HouseholdContext } from "@/lib/session";

/**
 * Recipe collections for /api/v1 (the native app). The web's server actions in
 * app/actions/collections.ts do the same work for the browser; both scope every
 * query to the household.
 */

export class CollectionNotFoundError extends Error {
  constructor(message = "Collection not found") {
    super(message);
    this.name = "CollectionNotFoundError";
  }
}

export class CollectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionValidationError";
  }
}

export type CollectionSummary = {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  recipeIds: string[];
};

/** Every collection, by name, with the ids of the recipes in it. */
export async function listCollections(ctx: HouseholdContext): Promise<CollectionSummary[]> {
  const rows = await db
    .select({
      id: collections.id,
      name: collections.name,
      icon: collections.icon,
      description: collections.description,
    })
    .from(collections)
    .where(eq(collections.householdId, ctx.householdId))
    .orderBy(asc(collections.name));
  if (!rows.length) return [];

  const links = await db
    .select({ collectionId: recipeCollections.collectionId, recipeId: recipeCollections.recipeId })
    .from(recipeCollections)
    .where(inArray(recipeCollections.collectionId, rows.map((r) => r.id)));

  const byCollection = new Map<string, string[]>();
  for (const link of links) {
    const list = byCollection.get(link.collectionId) ?? [];
    list.push(link.recipeId);
    byCollection.set(link.collectionId, list);
  }
  return rows.map((r) => ({ ...r, recipeIds: byCollection.get(r.id) ?? [] }));
}

export async function createCollection(
  ctx: HouseholdContext,
  input: { name: string; icon?: string | null }
): Promise<CollectionSummary> {
  const name = input.name.trim();
  if (!name) throw new CollectionValidationError("Collection name is required");

  const [created] = await db
    .insert(collections)
    .values({ householdId: ctx.householdId, name, icon: input.icon?.trim() || null })
    .returning({
      id: collections.id,
      name: collections.name,
      icon: collections.icon,
      description: collections.description,
    });
  return { ...created!, recipeIds: [] };
}

async function assertCollection(ctx: HouseholdContext, collectionId: string) {
  const [row] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.householdId, ctx.householdId)))
    .limit(1);
  if (!row) throw new CollectionNotFoundError();
}

export async function addRecipe(ctx: HouseholdContext, collectionId: string, recipeId: string) {
  await assertCollection(ctx, collectionId);
  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, ctx.householdId)))
    .limit(1);
  if (!recipe) throw new CollectionNotFoundError("Recipe not found");

  await db.insert(recipeCollections).values({ collectionId, recipeId }).onConflictDoNothing();
}

export async function removeRecipe(ctx: HouseholdContext, collectionId: string, recipeId: string) {
  await assertCollection(ctx, collectionId);
  await db
    .delete(recipeCollections)
    .where(and(eq(recipeCollections.collectionId, collectionId), eq(recipeCollections.recipeId, recipeId)));
}
