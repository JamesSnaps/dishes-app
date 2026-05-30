"use server";

import { db } from "@/lib/db";
import { collections, recipeCollections, recipes } from "@dishes/db/schema";
import { eq, and, ilike, sql as drizzleSql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export async function createCollection(formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const icon = (formData.get("icon") as string)?.trim() || null;

  if (!name) throw new Error("Collection name is required");

  await db.insert(collections).values({ householdId, name, icon, description });
  revalidatePath("/collections");
}

export async function updateCollection(collectionId: string, formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;
  const icon = (formData.get("icon") as string)?.trim() || null;

  if (!name) throw new Error("Collection name is required");

  await db
    .update(collections)
    .set({ name, icon, description })
    .where(
      and(eq(collections.id, collectionId), eq(collections.householdId, householdId))
    );

  revalidatePath("/collections");
  revalidatePath(`/collections/${collectionId}`);
}

export async function updateCollectionIcon(collectionId: string, icon: string | null) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  await db
    .update(collections)
    .set({ icon: icon || null })
    .where(
      and(eq(collections.id, collectionId), eq(collections.householdId, householdId))
    );

  revalidatePath("/collections");
  revalidatePath(`/collections/${collectionId}`);
}

export async function deleteCollection(collectionId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  await db
    .delete(collections)
    .where(
      and(eq(collections.id, collectionId), eq(collections.householdId, householdId))
    );

  revalidatePath("/collections");
}

export async function addRecipeToCollection(collectionId: string, recipeId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  // Verify the collection belongs to this household
  const col = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.householdId, householdId)))
    .limit(1);

  if (!col[0]) throw new Error("Collection not found");

  const rec = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);
  if (!rec[0]) throw new Error("Recipe not found");

  await db
    .insert(recipeCollections)
    .values({ collectionId, recipeId })
    .onConflictDoNothing();

  revalidatePath(`/collections/${collectionId}`);
  revalidatePath(`/recipes/${recipeId}`);
}

export async function removeRecipeFromCollection(collectionId: string, recipeId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  // Verify the collection belongs to this household
  const col = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.householdId, householdId)))
    .limit(1);

  if (!col[0]) throw new Error("Collection not found");

  await db
    .delete(recipeCollections)
    .where(
      and(
        eq(recipeCollections.collectionId, collectionId),
        eq(recipeCollections.recipeId, recipeId)
      )
    );

  revalidatePath(`/collections/${collectionId}`);
  revalidatePath(`/recipes/${recipeId}`);
}

export async function searchRecipesForCollection(collectionId: string, query: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const rows = await db
    .select({
      id: recipes.id,
      title: recipes.title,
      imageUrl: recipes.imageUrl,
      thumbnailUrl: recipes.thumbnailUrl,
      alreadyAdded: drizzleSql<boolean>`EXISTS (
        SELECT 1 FROM ${recipeCollections}
        WHERE ${recipeCollections.collectionId} = ${collectionId}
          AND ${recipeCollections.recipeId} = ${recipes.id}
      )`,
    })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, householdId),
        query.trim() ? ilike(recipes.title, `%${query.trim()}%`) : undefined
      )
    )
    .orderBy(recipes.title)
    .limit(20);

  return rows;
}

export async function getHouseholdCollections() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  return db
    .select({ id: collections.id, name: collections.name })
    .from(collections)
    .where(eq(collections.householdId, householdId))
    .orderBy(collections.name);
}
