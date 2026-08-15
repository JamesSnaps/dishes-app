"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import * as shoppingService from "@/lib/services/shopping";
import {
  ShoppingItemNotFoundError,
  ShoppingListNotFoundError,
  ShoppingValidationError,
} from "@/lib/services/shopping";

/**
 * Web transport for shopping-list writes: parse FormData, call the service,
 * revalidate. Domain logic lives in `lib/services/shopping.ts`, shared with the
 * offline endpoints under `app/api/shopping` and the client API under
 * `app/api/v1/shopping`.
 */

// Note: types are NOT re-exported from here. A "use server" file may only export
// async functions, and `export type { … } from …` is rejected by the compiler
// even though it erases at runtime. Consumers import these types straight from
// `@/lib/services/shopping` with `import type`.

/**
 * These actions historically no-opped rather than throwing when an item or list
 * had already gone (a second click on a stale row, a list archived in another
 * tab). Preserved deliberately — surfacing an error overlay for a row that is
 * already gone is worse than doing nothing.
 */
function ignoreMissing(err: unknown): void {
  if (
    err instanceof ShoppingItemNotFoundError ||
    err instanceof ShoppingListNotFoundError ||
    err instanceof ShoppingValidationError
  ) {
    return;
  }
  throw err;
}

export async function createList(formData: FormData) {
  const session = await requireSession();

  await shoppingService.createList(session, formData.get("name") as string);

  revalidatePath("/shopping");
}

export async function addItem(formData: FormData) {
  const session = await requireSession();

  try {
    await shoppingService.addItem(session, {
      ingredientName: (formData.get("ingredientName") as string) ?? "",
      amount: (formData.get("amount") as string)?.trim() || null,
      unit: (formData.get("unit") as string)?.trim() || null,
      category: (formData.get("category") as string)?.trim() || null,
    });
  } catch (err) {
    ignoreMissing(err);
    return;
  }

  revalidatePath("/shopping");
}

export async function toggleItem(itemId: string, checked: boolean) {
  const session = await requireSession();

  try {
    await shoppingService.toggleItem(session, itemId, checked);
  } catch (err) {
    ignoreMissing(err);
    return;
  }

  revalidatePath("/shopping");
}

export async function clearChecked(listId: string) {
  const session = await requireSession();

  try {
    await shoppingService.clearChecked(session, listId);
  } catch (err) {
    ignoreMissing(err);
    return;
  }

  revalidatePath("/shopping");
}

export async function archiveList(listId: string) {
  const session = await requireSession();

  try {
    await shoppingService.archiveList(session, listId);
  } catch (err) {
    ignoreMissing(err);
    return;
  }

  revalidatePath("/shopping");
}

export async function deleteItem(itemId: string) {
  const session = await requireSession();

  try {
    await shoppingService.deleteItem(session, itemId);
  } catch (err) {
    ignoreMissing(err);
    return;
  }

  revalidatePath("/shopping");
}

export async function previewShoppingGeneration(
  recipeId: string,
  servings?: number
) {
  const session = await requireSession();
  return shoppingService.previewShoppingGeneration(session, recipeId, servings);
}

export async function generateFromRecipe(
  recipeId: string,
  servings?: number,
  forceInclude?: string[]
) {
  const session = await requireSession();

  await shoppingService.generateFromRecipe(session, recipeId, servings, forceInclude);

  revalidatePath("/shopping");
}
