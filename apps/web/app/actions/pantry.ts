"use server";

import { db } from "@/lib/db";
import {
  pantryStaples,
  pantryStock,
  recipes,
  recipeIngredients,
  shoppingLists,
  shoppingListItems,
} from "@dishes/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

// ─── Staples ──────────────────────────────────────────────────────────────────

export async function addStaple(ingredientName: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const name = ingredientName.trim();
  if (!name) return;

  await db.insert(pantryStaples).values({ householdId, ingredientName: name });
  revalidatePath("/pantry");
}

export async function removeStaple(stapleId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  await db
    .delete(pantryStaples)
    .where(
      and(
        eq(pantryStaples.id, stapleId),
        eq(pantryStaples.householdId, householdId)
      )
    );
  revalidatePath("/pantry");
}

export async function removeStaples(stapleIds: string[]) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  if (stapleIds.length === 0) return;

  await db
    .delete(pantryStaples)
    .where(
      and(
        inArray(pantryStaples.id, stapleIds),
        eq(pantryStaples.householdId, householdId)
      )
    );
  revalidatePath("/pantry");
}

// ─── Stock ────────────────────────────────────────────────────────────────────

export async function addStockItem(formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const ingredientName = (formData.get("ingredientName") as string)?.trim();
  if (!ingredientName) return;

  const rawAmount = (formData.get("amount") as string)?.trim();
  const unit = (formData.get("unit") as string)?.trim() || null;
  const amount =
    rawAmount && !isNaN(parseFloat(rawAmount)) ? rawAmount : null;

  await db.insert(pantryStock).values({
    householdId,
    ingredientName,
    amount,
    unit,
  });
  revalidatePath("/pantry");
}

export async function removeStockItem(stockId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  await db
    .delete(pantryStock)
    .where(
      and(
        eq(pantryStock.id, stockId),
        eq(pantryStock.householdId, householdId)
      )
    );
  revalidatePath("/pantry");
}

export async function removeStockItems(stockIds: string[]) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  if (stockIds.length === 0) return;

  await db
    .delete(pantryStock)
    .where(
      and(
        inArray(pantryStock.id, stockIds),
        eq(pantryStock.householdId, householdId)
      )
    );
  revalidatePath("/pantry");
}

export async function updateStockItem(
  stockId: string,
  values: { ingredientName: string; amount: string | null; unit: string | null }
) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const name = values.ingredientName.trim();
  if (!name) return;

  const amount =
    values.amount && !isNaN(parseFloat(values.amount)) ? values.amount : null;

  await db
    .update(pantryStock)
    .set({
      ingredientName: name,
      amount,
      unit: values.unit?.trim() || null,
    })
    .where(
      and(
        eq(pantryStock.id, stockId),
        eq(pantryStock.householdId, householdId)
      )
    );
  revalidatePath("/pantry");
}

export async function updateStockAmount(stockId: string, amount: string | null) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const parsed = amount && !isNaN(parseFloat(amount)) ? amount : null;

  await db
    .update(pantryStock)
    .set({ amount: parsed })
    .where(
      and(
        eq(pantryStock.id, stockId),
        eq(pantryStock.householdId, householdId)
      )
    );
  revalidatePath("/pantry");
}

// ─── Cooking integration ──────────────────────────────────────────────────────

export async function deductRecipeIngredients(recipeId: string, servings: number) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ servings: recipes.servings })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) return;

  const baseServings = recipe.servings ? parseFloat(recipe.servings) : null;
  const scale =
    baseServings && baseServings > 0 ? servings / baseServings : 1;

  const [ingredients, staples, stock] = await Promise.all([
    db
      .select({
        ingredientName: recipeIngredients.ingredientName,
        amount: recipeIngredients.amount,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeId))
      .orderBy(asc(recipeIngredients.position)),
    db
      .select({ ingredientName: pantryStaples.ingredientName })
      .from(pantryStaples)
      .where(eq(pantryStaples.householdId, householdId)),
    db
      .select()
      .from(pantryStock)
      .where(eq(pantryStock.householdId, householdId)),
  ]);

  const stapleNames = new Set(
    staples.map((s) => s.ingredientName.toLowerCase().trim())
  );

  for (const ing of ingredients) {
    const normalName = ing.ingredientName.toLowerCase().trim();

    if (stapleNames.has(normalName)) continue;

    const rawNum = ing.amount !== null ? parseFloat(ing.amount) : NaN;
    if (isNaN(rawNum)) continue;

    const scaledAmount = rawNum * scale;

    const stockItem = stock.find(
      (s) =>
        s.ingredientName.toLowerCase().trim() === normalName &&
        s.unit === ing.unit
    );

    if (!stockItem) continue;

    const current = stockItem.amount ? parseFloat(stockItem.amount) : 0;
    const remaining = current - scaledAmount;

    if (remaining <= 0) {
      await db
        .delete(pantryStock)
        .where(eq(pantryStock.id, stockItem.id));
    } else {
      await db
        .update(pantryStock)
        .set({ amount: remaining.toFixed(3) })
        .where(eq(pantryStock.id, stockItem.id));
    }
  }

  revalidatePath("/pantry");
}

// ─── Shopping list → stock ────────────────────────────────────────────────────

export async function addCheckedItemsToStock(listId: string) {
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

  const checkedItems = await db
    .select({
      ingredientName: shoppingListItems.ingredientName,
      amount: shoppingListItems.amount,
      unit: shoppingListItems.unit,
    })
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.listId, listId),
        eq(shoppingListItems.isChecked, true)
      )
    );

  const currentStock = await db
    .select()
    .from(pantryStock)
    .where(eq(pantryStock.householdId, householdId));

  for (const item of checkedItems) {
    const normalName = item.ingredientName.toLowerCase().trim();
    const newAmt = item.amount ? parseFloat(item.amount) : null;

    const existing = currentStock.find(
      (s) =>
        s.ingredientName.toLowerCase().trim() === normalName &&
        s.unit === item.unit
    );

    if (existing) {
      if (newAmt !== null && existing.amount) {
        const merged = parseFloat(existing.amount) + newAmt;
        await db
          .update(pantryStock)
          .set({ amount: merged.toFixed(3) })
          .where(eq(pantryStock.id, existing.id));
      }
    } else {
      await db.insert(pantryStock).values({
        householdId,
        ingredientName: item.ingredientName,
        amount: newAmt !== null ? newAmt.toFixed(3) : null,
        unit: item.unit,
      });
    }
  }

  revalidatePath("/pantry");
  revalidatePath("/shopping");
}
