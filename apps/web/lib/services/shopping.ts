/**
 * Shopping list domain logic — shared by server actions
 * (`app/actions/shopping.ts`), the PWA offline endpoints (`app/api/shopping/*`)
 * and the client API (`app/api/v1/shopping/*`).
 *
 * Follows the same rules as `lib/services/recipes.ts`: takes a context, takes
 * typed objects, scopes every query by householdId, never redirects or calls
 * revalidatePath. Household push notifications DO live here — notifying the
 * household is domain behaviour, not a web-transport concern, and keeping it
 * here is what makes an offline edit synced from a phone notify the family the
 * same way an edit made in the browser does.
 */

import { db } from "@/lib/db";
import {
  shoppingLists,
  shoppingListItems,
  shoppingListItemRecipes,
  recipes,
  recipeIngredients,
  pantryStaples,
  pantryStock,
} from "@dishes/db/schema";
import { eq, and, asc, max, count } from "drizzle-orm";
import { notifyHouseholdThrottled } from "@/lib/push";
import { getPantryExclusions, isCoveredByPantry } from "@/lib/pantry-exclusions";
import { getItemRecipeTitles, orderTitles } from "@/lib/shopping-item-sources";
import type { ActorContext, HouseholdContext } from "@/lib/session";

// --- Errors -----------------------------------------------------------------

export class ShoppingListNotFoundError extends Error {
  constructor() {
    super("Shopping list not found");
    this.name = "ShoppingListNotFoundError";
  }
}

export class ShoppingItemNotFoundError extends Error {
  constructor() {
    super("Shopping list item not found");
    this.name = "ShoppingItemNotFoundError";
  }
}

export class ShoppingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShoppingValidationError";
  }
}

// --- Push -------------------------------------------------------------------

// Collapse bursts of shopping-list changes into at most one push per household
// per window. All shopping mutations share this channel so adding a recipe and
// then typing items doesn't double-notify.
const SHOPPING_PUSH_CHANNEL = "shopping";
const SHOPPING_PUSH_WINDOW_SECONDS = 90;

/**
 * Fire-and-forget on purpose, and never awaited by callers.
 *
 * A push is a side effect of the write, not part of it: it must not be able to
 * slow one down, and its failure must not fail one. It also must not sit inside
 * a transaction — sync's push path now wraps each mutation and its idempotency
 * ledger entry in one, and awaiting a Redis round-trip plus web-push fan-out in
 * there would hold a connection from a small pool across network I/O.
 *
 * Safe to leave floating: `notifyHouseholdThrottled` handles its own Redis
 * errors and `notifyHousehold` swallows send failures, so this rejects under no
 * circumstances. The container is long-lived, so there is no request teardown
 * to cut it short either.
 */
function notifyShoppingChange(householdId: string, actorName: string): void {
  void notifyHouseholdThrottled(
    householdId,
    SHOPPING_PUSH_CHANNEL,
    SHOPPING_PUSH_WINDOW_SECONDS,
    {
      title: "🛒 Shopping list updated",
      body: `${actorName} changed the shopping list`,
      url: "/shopping",
    }
  );
}

// --- List helpers -----------------------------------------------------------

function defaultListName() {
  return `Shopping – ${new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })}`;
}

export async function getActiveList(ctx: HouseholdContext) {
  const [list] = await db
    .select({ id: shoppingLists.id, name: shoppingLists.name })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.householdId, ctx.householdId),
        eq(shoppingLists.status, "active")
      )
    )
    // Oldest first: nothing stops a household having two active lists, and
    // every path that resolves "the active list" must pick the same one.
    .orderBy(asc(shoppingLists.createdAt))
    .limit(1);

  return list ?? null;
}

export async function ensureActiveList(ctx: HouseholdContext) {
  const existing = await getActiveList(ctx);
  if (existing) return existing;

  const [list] = await db
    .insert(shoppingLists)
    .values({
      householdId: ctx.householdId,
      createdById: ctx.memberId,
      name: defaultListName(),
    })
    .returning({ id: shoppingLists.id, name: shoppingLists.name });

  return list!;
}

/** Throws unless the list exists and belongs to this household. */
async function assertListOwned(listId: string, householdId: string) {
  const [list] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.householdId, householdId)))
    .limit(1);

  if (!list) throw new ShoppingListNotFoundError();
  return list;
}

/** Throws unless the item's list belongs to this household. */
async function assertItemOwned(itemId: string, householdId: string) {
  const [item] = await db
    .select({ listId: shoppingListItems.listId })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.id, itemId))
    .limit(1);

  if (!item) throw new ShoppingItemNotFoundError();

  try {
    await assertListOwned(item.listId, householdId);
  } catch {
    // Don't leak that the item exists in someone else's household.
    throw new ShoppingItemNotFoundError();
  }

  return item;
}

// --- Reads ------------------------------------------------------------------

export type ShoppingListView = {
  listId: string | null;
  listName: string | null;
  items: Array<{
    id: string;
    listId: string;
    ingredientName: string;
    amount: string | null;
    unit: string | null;
    notes: string | null;
    isChecked: boolean;
    category: string | null;
    position: number;
    recipeId: string | null;
    recipeTitle: string | null;
    recipeTitles: string[];
  }>;
};

/** The active list and its items, with contributing recipe titles resolved. */
export async function getActiveListWithItems(
  ctx: HouseholdContext
): Promise<ShoppingListView> {
  const list = await getActiveList(ctx);
  if (!list) return { listId: null, listName: null, items: [] };

  const items = await db
    .select({
      id: shoppingListItems.id,
      listId: shoppingListItems.listId,
      ingredientName: shoppingListItems.ingredientName,
      amount: shoppingListItems.amount,
      unit: shoppingListItems.unit,
      notes: shoppingListItems.notes,
      isChecked: shoppingListItems.isChecked,
      category: shoppingListItems.category,
      position: shoppingListItems.position,
      recipeId: shoppingListItems.recipeId,
      recipeTitle: recipes.title,
    })
    .from(shoppingListItems)
    .leftJoin(recipes, eq(shoppingListItems.recipeId, recipes.id))
    .where(eq(shoppingListItems.listId, list.id))
    .orderBy(asc(shoppingListItems.position));

  const titlesByItem = await getItemRecipeTitles(items.map((i) => i.id));

  return {
    listId: list.id,
    listName: list.name,
    items: items.map((i) => ({
      ...i,
      recipeTitle: i.recipeTitle ?? null,
      recipeTitles: orderTitles(i.recipeTitle ?? null, titlesByItem.get(i.id)),
    })),
  };
}

/** Unchecked item count for the active list — feeds the nav badge. */
export async function getUncheckedCount(ctx: HouseholdContext): Promise<number> {
  const list = await getActiveList(ctx);
  if (!list) return 0;

  const [row] = await db
    .select({ value: count() })
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.listId, list.id),
        eq(shoppingListItems.isChecked, false)
      )
    );

  return Number(row?.value ?? 0);
}

// --- List writes ------------------------------------------------------------

export async function createList(
  ctx: HouseholdContext,
  name?: string | null
): Promise<string> {
  const [list] = await db
    .insert(shoppingLists)
    .values({
      householdId: ctx.householdId,
      createdById: ctx.memberId,
      name: name?.trim() || defaultListName(),
    })
    .returning({ id: shoppingLists.id });

  return list!.id;
}

export async function archiveList(
  ctx: HouseholdContext,
  listId: string
): Promise<void> {
  await assertListOwned(listId, ctx.householdId);

  await db
    .update(shoppingLists)
    .set({ status: "archived" })
    .where(
      and(eq(shoppingLists.id, listId), eq(shoppingLists.householdId, ctx.householdId))
    );
}

/** Returns how many items were removed. */
export async function clearChecked(
  ctx: ActorContext,
  listId: string
): Promise<number> {
  await assertListOwned(listId, ctx.householdId);

  const cleared = await db
    .delete(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.listId, listId),
        eq(shoppingListItems.isChecked, true)
      )
    );

  if (cleared.count > 0) {
    notifyShoppingChange(ctx.householdId, ctx.actorName);
  }

  return cleared.count;
}

// --- Item writes ------------------------------------------------------------

export type AddItemInput = {
  ingredientName: string;
  amount?: string | null;
  unit?: string | null;
  category?: string | null;
  notes?: string | null;
  /**
   * Client-generated id, used by the offline mutation queue so an item created
   * on-device keeps its identity when the queue drains.
   */
  id?: string;
  /** Explicit list; defaults to the active list, creating one if needed. */
  listId?: string;
  /** Explicit position; defaults to the end of the list. */
  position?: number;
};

export async function addItem(ctx: ActorContext, input: AddItemInput) {
  const ingredientName = input.ingredientName?.trim();
  if (!ingredientName) {
    throw new ShoppingValidationError("ingredientName required");
  }

  const listId = input.listId
    ? (await assertListOwned(input.listId, ctx.householdId)).id
    : (await ensureActiveList(ctx)).id;

  let position = input.position;
  if (position === undefined) {
    const [maxRow] = await db
      .select({ pos: max(shoppingListItems.position) })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, listId));
    position = (maxRow?.pos ?? -1) + 1;
  }

  const [item] = await db
    .insert(shoppingListItems)
    .values({
      id: input.id,
      listId,
      ingredientName,
      amount: input.amount || null,
      unit: input.unit || null,
      category: input.category || null,
      notes: input.notes || null,
      position,
    })
    .returning();

  notifyShoppingChange(ctx.householdId, ctx.actorName);

  return item!;
}

export type UpdateItemInput = {
  ingredientName?: string;
  amount?: string | null;
  unit?: string | null;
  notes?: string | null;
  category?: string | null;
};

export async function updateItem(
  ctx: HouseholdContext,
  itemId: string,
  input: UpdateItemInput
): Promise<void> {
  await assertItemOwned(itemId, ctx.householdId);

  if ("ingredientName" in input && !input.ingredientName?.trim()) {
    throw new ShoppingValidationError("ingredientName required");
  }

  const updates: Partial<typeof shoppingListItems.$inferInsert> = {};
  if (input.ingredientName !== undefined) {
    updates.ingredientName = input.ingredientName.trim();
  }
  if ("amount" in input) updates.amount = input.amount || null;
  if ("unit" in input) updates.unit = input.unit || null;
  if ("notes" in input) updates.notes = input.notes || null;
  if ("category" in input) updates.category = input.category || null;

  if (Object.keys(updates).length === 0) {
    throw new ShoppingValidationError("No fields to update");
  }

  await db
    .update(shoppingListItems)
    .set(updates)
    .where(eq(shoppingListItems.id, itemId));
}

/**
 * Check or uncheck an item. Deliberately does NOT notify the household —
 * ticking items off in a supermarket would otherwise spam every device.
 */
export async function toggleItem(
  ctx: HouseholdContext,
  itemId: string,
  checked: boolean
): Promise<void> {
  await assertItemOwned(itemId, ctx.householdId);

  await db
    .update(shoppingListItems)
    .set({ isChecked: checked })
    .where(eq(shoppingListItems.id, itemId));
}

export async function deleteItem(ctx: ActorContext, itemId: string): Promise<void> {
  await assertItemOwned(itemId, ctx.householdId);

  await db.delete(shoppingListItems).where(eq(shoppingListItems.id, itemId));

  notifyShoppingChange(ctx.householdId, ctx.actorName);
}

// --- Generation from a recipe ----------------------------------------------

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

/** Recipe (scoped to the household) plus its scale factor for a serving count. */
async function loadRecipeForGeneration(
  householdId: string,
  recipeId: string,
  servings?: number
) {
  const [recipe] = await db
    .select({ id: recipes.id, servings: recipes.servings, title: recipes.title })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) return null;

  const baseServings = recipe.servings ? parseFloat(recipe.servings) : null;
  const scale =
    servings && baseServings && baseServings > 0 ? servings / baseServings : 1;

  const ingredients = await db
    .select({
      ingredientName: recipeIngredients.ingredientName,
      amount: recipeIngredients.amount,
      unit: recipeIngredients.unit,
    })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(asc(recipeIngredients.position));

  return { recipe, scale, ingredients };
}

/**
 * What generateFromRecipe would add and what it would skip, without writing.
 * Returns an empty preview for an unknown recipe rather than throwing — this
 * feeds a UI sheet that opens optimistically.
 */
export async function previewShoppingGeneration(
  ctx: HouseholdContext,
  recipeId: string,
  servings?: number
): Promise<ShoppingPreview> {
  const loaded = await loadRecipeForGeneration(ctx.householdId, recipeId, servings);
  if (!loaded) return { adding: [], skipped: [] };

  const { scale, ingredients } = loaded;

  const [staples, stock] = await Promise.all([
    db
      .select({ ingredientName: pantryStaples.ingredientName })
      .from(pantryStaples)
      .where(eq(pantryStaples.householdId, ctx.householdId)),
    db
      .select({
        ingredientName: pantryStock.ingredientName,
        amount: pantryStock.amount,
        unit: pantryStock.unit,
      })
      .from(pantryStock)
      .where(eq(pantryStock.householdId, ctx.householdId)),
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

    adding.push({
      ingredientName: ing.ingredientName,
      amount: scaledAmount !== null ? scaledAmount.toString() : null,
      unit: ing.unit,
    });
  }

  return { adding, skipped };
}

export type GenerateResult = { listId: string; changed: boolean };

/**
 * Pull a recipe's ingredients onto the active shopping list, scaling to the
 * requested servings, skipping anything the pantry already covers (unless named
 * in forceInclude), and merging into an existing unchecked line where one
 * matches on name and unit.
 */
export async function generateFromRecipe(
  ctx: ActorContext,
  recipeId: string,
  servings?: number,
  forceInclude?: string[]
): Promise<GenerateResult> {
  const loaded = await loadRecipeForGeneration(ctx.householdId, recipeId, servings);
  if (!loaded) throw new Error("Recipe not found");

  const { scale, ingredients } = loaded;

  const [list, exclusions] = await Promise.all([
    ensureActiveList(ctx),
    getPantryExclusions(ctx.householdId),
  ]);

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
      isChecked: shoppingListItems.isChecked,
    })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, list.id));

  const maxPos = existing.length ? Math.max(...existing.map((i) => i.position)) : -1;
  let posCounter = maxPos + 1;
  let changed = false;

  for (const ing of ingredients) {
    const normalName = ing.ingredientName.toLowerCase().trim();
    const forced = forceIncludeNames.has(normalName);

    const rawNum = ing.amount !== null ? parseFloat(ing.amount) : NaN;
    const isNumeric = !isNaN(rawNum);
    const scaledAmount = isNumeric ? rawNum * scale : null;

    // Skip staples and fully-stocked ingredients — unless explicitly overridden
    if (
      !forced &&
      isCoveredByPantry(exclusions, ing.ingredientName, scaledAmount, ing.unit)
    ) {
      continue;
    }

    const scaledAmountStr = scaledAmount !== null ? scaledAmount.toString() : null;
    // Non-numeric amounts like "small handful" / "to taste" go into notes
    const textNote = !isNumeric && ing.amount ? ing.amount : null;

    const match = existing.find(
      (e) =>
        !e.isChecked &&
        e.ingredientName.toLowerCase().trim() === normalName &&
        e.unit === ing.unit
    );

    if (match && match.amount !== null && scaledAmountStr !== null) {
      const newAmount = (
        Math.round(
          (parseFloat(match.amount) + parseFloat(scaledAmountStr)) * 1000
        ) / 1000
      ).toString();
      await db
        .update(shoppingListItems)
        .set({ amount: newAmount })
        .where(eq(shoppingListItems.id, match.id));
      await db
        .insert(shoppingListItemRecipes)
        .values({ itemId: match.id, recipeId })
        .onConflictDoNothing();
    } else {
      const [inserted] = await db
        .insert(shoppingListItems)
        .values({
          listId: list.id,
          recipeId,
          ingredientName: ing.ingredientName,
          amount: scaledAmountStr,
          unit: ing.unit,
          notes: textNote,
          position: posCounter++,
        })
        .returning({ id: shoppingListItems.id });
      await db
        .insert(shoppingListItemRecipes)
        .values({ itemId: inserted!.id, recipeId })
        .onConflictDoNothing();
    }
    changed = true;
  }

  if (changed) {
    notifyShoppingChange(ctx.householdId, ctx.actorName);
  }

  return { listId: list.id, changed };
}
