"use server";

import { db } from "@/lib/db";
import {
  shoppingLists,
  shoppingListItems,
  recipes,
  recipeIngredients,
} from "@dishes/db/schema";
import { eq, and, asc, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

async function getActiveList(householdId: string) {
  const [list] = await db
    .select({ id: shoppingLists.id, name: shoppingLists.name })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.householdId, householdId),
        eq(shoppingLists.status, "active")
      )
    )
    .limit(1);
  return list ?? null;
}

async function ensureActiveList(householdId: string, memberId: string) {
  const existing = await getActiveList(householdId);
  if (existing) return existing;

  const name = `Shopping – ${new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })}`;
  const [list] = await db
    .insert(shoppingLists)
    .values({ householdId, createdById: memberId, name })
    .returning({ id: shoppingLists.id, name: shoppingLists.name });
  return list!;
}

export async function createList(formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const name =
    (formData.get("name") as string)?.trim() ||
    `Shopping – ${new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    })}`;

  await db
    .insert(shoppingLists)
    .values({ householdId, createdById: memberId, name });
  revalidatePath("/shopping");
}

export async function addItem(formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const ingredientName = (formData.get("ingredientName") as string)?.trim();
  if (!ingredientName) return;

  const list = await ensureActiveList(householdId, memberId);

  const [maxRow] = await db
    .select({ pos: max(shoppingListItems.position) })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, list.id));

  const nextPos = (maxRow?.pos ?? -1) + 1;

  await db.insert(shoppingListItems).values({
    listId: list.id,
    ingredientName,
    amount: (formData.get("amount") as string)?.trim() || null,
    unit: (formData.get("unit") as string)?.trim() || null,
    category: (formData.get("category") as string)?.trim() || null,
    position: nextPos,
  });

  revalidatePath("/shopping");
}

export async function toggleItem(itemId: string, checked: boolean) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  // Verify the item's list belongs to this household
  const [item] = await db
    .select({ listId: shoppingListItems.listId })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.id, itemId))
    .limit(1);

  if (!item) return;

  const [list] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, item.listId),
        eq(shoppingLists.householdId, householdId)
      )
    )
    .limit(1);

  if (!list) return;

  await db
    .update(shoppingListItems)
    .set({ isChecked: checked })
    .where(eq(shoppingListItems.id, itemId));

  revalidatePath("/shopping");
}

export async function clearChecked(listId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [list] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, householdId)
      )
    )
    .limit(1);

  if (!list) return;

  await db
    .delete(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.listId, listId),
        eq(shoppingListItems.isChecked, true)
      )
    );

  revalidatePath("/shopping");
}

export async function archiveList(listId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  await db
    .update(shoppingLists)
    .set({ status: "archived" })
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, householdId)
      )
    );

  revalidatePath("/shopping");
}

export async function deleteItem(itemId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  // Verify ownership via the list
  const [item] = await db
    .select({ listId: shoppingListItems.listId })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.id, itemId))
    .limit(1);

  if (!item) return;

  const [list] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, item.listId),
        eq(shoppingLists.householdId, householdId)
      )
    )
    .limit(1);

  if (!list) return;

  await db
    .delete(shoppingListItems)
    .where(eq(shoppingListItems.id, itemId));

  revalidatePath("/shopping");
}

export async function generateFromRecipe(recipeId: string) {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId))
    )
    .limit(1);

  if (!recipe) throw new Error("Recipe not found");

  const ingredients = await db
    .select({
      ingredientName: recipeIngredients.ingredientName,
      amount: recipeIngredients.amount,
      unit: recipeIngredients.unit,
    })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(asc(recipeIngredients.position));

  const list = await ensureActiveList(householdId, memberId);

  const existing = await db
    .select({
      id: shoppingListItems.id,
      ingredientName: shoppingListItems.ingredientName,
      amount: shoppingListItems.amount,
      unit: shoppingListItems.unit,
      position: shoppingListItems.position,
    })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, list.id));

  const maxPos = existing.length
    ? Math.max(...existing.map((i) => i.position))
    : -1;
  let posCounter = maxPos + 1;

  for (const ing of ingredients) {
    const normalName = ing.ingredientName.toLowerCase().trim();
    const match = existing.find(
      (e) =>
        e.ingredientName.toLowerCase().trim() === normalName &&
        e.unit === ing.unit
    );

    if (match && match.amount !== null && ing.amount !== null) {
      const newAmount = (
        parseFloat(match.amount) + parseFloat(ing.amount)
      ).toString();
      await db
        .update(shoppingListItems)
        .set({ amount: newAmount })
        .where(eq(shoppingListItems.id, match.id));
    } else {
      await db.insert(shoppingListItems).values({
        listId: list.id,
        recipeId,
        ingredientName: ing.ingredientName,
        amount: ing.amount,
        unit: ing.unit,
        position: posCounter++,
      });
    }
  }

  revalidatePath("/shopping");
}
