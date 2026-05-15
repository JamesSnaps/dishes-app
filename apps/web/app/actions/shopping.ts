"use server";

import { db } from "@/lib/db";
import {
  shoppingLists,
  shoppingListItems,
  recipes,
  recipeIngredients,
  pantryStaples,
  pantryStock,
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

export type SkippedIngredient = {
  ingredientName: string;
  amount: string | null;
  unit: string | null;
  reason: "staple" | "in_stock";
};

export type AddingIngredient = {
  ingredientName: string;
  amount: string | null;
  unit: string | null;
};

export type ShoppingPreview = {
  adding: AddingIngredient[];
  skipped: SkippedIngredient[];
};

export async function previewShoppingGeneration(
  recipeId: string,
  servings?: number
): Promise<ShoppingPreview> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ id: recipes.id, servings: recipes.servings })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) return { adding: [], skipped: [] };

  const baseServings = recipe.servings ? parseFloat(recipe.servings) : null;
  const scale =
    servings && baseServings && baseServings > 0
      ? servings / baseServings
      : 1;

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
      .select({
        ingredientName: pantryStock.ingredientName,
        amount: pantryStock.amount,
        unit: pantryStock.unit,
      })
      .from(pantryStock)
      .where(eq(pantryStock.householdId, householdId)),
  ]);

  const stapleNames = new Set(
    staples.map((s) => s.ingredientName.toLowerCase().trim())
  );

  const adding: AddingIngredient[] = [];
  const skipped: SkippedIngredient[] = [];

  for (const ing of ingredients) {
    const normalName = ing.ingredientName.toLowerCase().trim();

    if (stapleNames.has(normalName)) {
      skipped.push({
        ingredientName: ing.ingredientName,
        amount: ing.amount,
        unit: ing.unit,
        reason: "staple",
      });
      continue;
    }

    const rawNum = ing.amount !== null ? parseFloat(ing.amount) : NaN;
    const scaledAmount = !isNaN(rawNum) ? rawNum * scale : null;

    if (scaledAmount !== null) {
      const stockItem = stock.find(
        (s) =>
          s.ingredientName.toLowerCase().trim() === normalName &&
          s.unit === ing.unit
      );
      if (stockItem?.amount && parseFloat(stockItem.amount) >= scaledAmount) {
        skipped.push({
          ingredientName: ing.ingredientName,
          amount: ing.amount,
          unit: ing.unit,
          reason: "in_stock",
        });
        continue;
      }
    }

    const scaledAmountStr =
      scaledAmount !== null ? scaledAmount.toString() : null;
    adding.push({
      ingredientName: ing.ingredientName,
      amount: scaledAmountStr,
      unit: ing.unit,
    });
  }

  return { adding, skipped };
}

export async function generateFromRecipe(
  recipeId: string,
  servings?: number,
  forceInclude?: string[]
) {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ id: recipes.id, servings: recipes.servings })
    .from(recipes)
    .where(
      and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId))
    )
    .limit(1);

  if (!recipe) throw new Error("Recipe not found");

  const baseServings = recipe.servings ? parseFloat(recipe.servings) : null;
  const scale =
    servings && baseServings && baseServings > 0
      ? servings / baseServings
      : 1;

  const ingredients = await db
    .select({
      ingredientName: recipeIngredients.ingredientName,
      amount: recipeIngredients.amount,
      unit: recipeIngredients.unit,
    })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(asc(recipeIngredients.position));

  const [list, staples, stock] = await Promise.all([
    ensureActiveList(householdId, memberId),
    db
      .select({ ingredientName: pantryStaples.ingredientName })
      .from(pantryStaples)
      .where(eq(pantryStaples.householdId, householdId)),
    db
      .select({
        ingredientName: pantryStock.ingredientName,
        amount: pantryStock.amount,
        unit: pantryStock.unit,
      })
      .from(pantryStock)
      .where(eq(pantryStock.householdId, householdId)),
  ]);

  const stapleNames = new Set(
    staples.map((s) => s.ingredientName.toLowerCase().trim())
  );

  const forceIncludeNames = new Set(
    (forceInclude ?? []).map((n) => n.toLowerCase().trim())
  );

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

    const forced = forceIncludeNames.has(normalName);

    // Skip staples — unless explicitly overridden
    if (!forced && stapleNames.has(normalName)) continue;

    const rawNum = ing.amount !== null ? parseFloat(ing.amount) : NaN;
    const isNumeric = !isNaN(rawNum);
    const scaledAmount = isNumeric ? rawNum * scale : null;

    // Skip if sufficient stock exists — unless explicitly overridden
    if (!forced && scaledAmount !== null) {
      const stockItem = stock.find(
        (s) =>
          s.ingredientName.toLowerCase().trim() === normalName &&
          s.unit === ing.unit
      );
      if (stockItem?.amount && parseFloat(stockItem.amount) >= scaledAmount) {
        continue;
      }
    }

    const scaledAmountStr = scaledAmount !== null ? scaledAmount.toString() : null;
    // Non-numeric amounts like "small handful" / "to taste" go into notes
    const textNote = !isNumeric && ing.amount ? ing.amount : null;

    const match = existing.find(
      (e) =>
        e.ingredientName.toLowerCase().trim() === normalName &&
        e.unit === ing.unit
    );

    if (match && match.amount !== null && scaledAmountStr !== null) {
      const newAmount = (
        parseFloat(match.amount) + parseFloat(scaledAmountStr)
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
        amount: scaledAmountStr,
        unit: ing.unit,
        notes: textNote,
        position: posCounter++,
      });
    }
  }

  revalidatePath("/shopping");
}
