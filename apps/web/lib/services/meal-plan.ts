/**
 * Meal plan domain logic — shared by server actions (`app/actions/meal-plan.ts`)
 * and the client API (`app/api/v1/meal-plan/*`).
 *
 * Same rules as the other services: takes a context, takes typed objects,
 * scopes every query by householdId, never redirects or calls revalidatePath.
 * Household push notifications live here so a plan created from a phone
 * notifies the family exactly as one created in the browser does.
 */

import { db } from "@/lib/db";
import {
  mealPlans,
  mealPlanEntries,
  recipes,
  recipeIngredients,
  shoppingListItems,
  shoppingListItemRecipes,
  householdMembers,
} from "@dishes/db/schema";
import { eq, and, asc, inArray, isNull, sql } from "drizzle-orm";
import { MEAL_TYPES, type MealType } from "@dishes/shared";
import { notifyHousehold } from "@/lib/push";
import {
  getPantryExclusions,
  isCoveredByPantry,
  type PantryExclusions,
} from "@/lib/pantry-exclusions";
import { ensureActiveList } from "@/lib/services/shopping";
import type { ActorContext, HouseholdContext, Session } from "@/lib/session";
import type { MealPlanSlot } from "@/app/actions/ai";

/** Push exclusion needs the raw username, which ActorContext doesn't carry. */
type PushContext = ActorContext & Pick<Session, "user">;

// --- Errors -----------------------------------------------------------------

export class MealPlanNotFoundError extends Error {
  constructor() {
    super("Meal plan not found");
    this.name = "MealPlanNotFoundError";
  }
}

export class MealPlanEntryNotFoundError extends Error {
  constructor() {
    super("Meal plan entry not found");
    this.name = "MealPlanEntryNotFoundError";
  }
}

export class MealPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MealPlanValidationError";
  }
}

// --- Validation -------------------------------------------------------------

export function assertDayOfWeek(day: number): void {
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    throw new MealPlanValidationError(
      "dayOfWeek must be an integer between 0 (Mon) and 6 (Sun)"
    );
  }
}

export function assertMealType(mealType: string): asserts mealType is MealType {
  if (!(MEAL_TYPES as readonly string[]).includes(mealType)) {
    throw new MealPlanValidationError("Invalid meal type");
  }
}

// --- Servings from who's eating --------------------------------------------

// Appetite scaling: a younger child eats less than an adult, so each selected
// family member contributes a fraction of a serving based on their age. Members
// with no birth year (or adults) count as a full serving. Tweak here to adjust.
function appetiteFactor(age: number | null, role: string): number {
  if (role === "adult") return 1;
  if (age === null) return 1;
  if (age < 1) return 0;
  if (age <= 3) return 0.3;
  if (age <= 6) return 0.5;
  if (age <= 10) return 0.6;
  if (age <= 14) return 0.8;
  return 1; // 15+
}

/**
 * Sum appetite factors for the selected members and round to a whole number of
 * servings (floor of 1). Returns null when no members are selected so callers
 * fall back to the recipe's base servings.
 */
async function servingsForMembers(
  householdId: string,
  memberIds: string[]
): Promise<number | null> {
  if (!memberIds.length) return null;

  const members = await db
    .select({ birthYear: householdMembers.birthYear, role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        inArray(householdMembers.id, memberIds)
      )
    );

  if (!members.length) return null;

  const currentYear = new Date().getFullYear();
  const total = members.reduce((sum, m) => {
    const age = m.birthYear ? currentYear - m.birthYear : null;
    return sum + appetiteFactor(age, m.role);
  }, 0);

  return Math.max(1, Math.round(total));
}

// --- Plan + entry helpers ---------------------------------------------------

async function getOrCreatePlan(ctx: HouseholdContext, weekStartDate: string) {
  const [row] = await db
    .insert(mealPlans)
    .values({
      householdId: ctx.householdId,
      createdById: ctx.memberId,
      weekStartDate,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [mealPlans.householdId, mealPlans.weekStartDate],
      set: { updatedAt: sql`now()` },
    })
    .returning({ id: mealPlans.id });

  return row!;
}

/** Single query verifying the entry exists and belongs to this household. */
async function assertEntryOwned(entryId: string, householdId: string) {
  const [entry] = await db
    .select({ id: mealPlanEntries.id })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .where(
      and(eq(mealPlanEntries.id, entryId), eq(mealPlans.householdId, householdId))
    )
    .limit(1);

  if (!entry) throw new MealPlanEntryNotFoundError();
  return entry;
}

async function assertPlanOwned(mealPlanId: string, householdId: string) {
  const [plan] = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(and(eq(mealPlans.id, mealPlanId), eq(mealPlans.householdId, householdId)))
    .limit(1);

  if (!plan) throw new MealPlanNotFoundError();
  return plan;
}

// --- Reads ------------------------------------------------------------------

/**
 * A week's plan with its entries and enough recipe detail to render a card.
 * Returns a null plan (and no entries) when the week has never been planned.
 */
export async function getWeek(ctx: HouseholdContext, weekStartDate: string) {
  const [plan] = await db
    .select({
      id: mealPlans.id,
      weekStartDate: mealPlans.weekStartDate,
      status: mealPlans.status,
      notes: mealPlans.notes,
    })
    .from(mealPlans)
    .where(
      and(
        eq(mealPlans.householdId, ctx.householdId),
        eq(mealPlans.weekStartDate, weekStartDate)
      )
    )
    .limit(1);

  if (!plan) return { plan: null, entries: [] };

  const entries = await db
    .select({
      id: mealPlanEntries.id,
      dayOfWeek: mealPlanEntries.dayOfWeek,
      mealType: mealPlanEntries.mealType,
      servings: mealPlanEntries.servings,
      notes: mealPlanEntries.notes,
      addedToShoppingListAt: mealPlanEntries.addedToShoppingListAt,
      recipe: {
        id: recipes.id,
        title: recipes.title,
        cuisine: recipes.cuisine,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
        servings: recipes.servings,
        difficulty: recipes.difficulty,
        thumbnailUrl: recipes.thumbnailUrl,
        calories: recipes.calories,
      },
    })
    .from(mealPlanEntries)
    .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
    .where(eq(mealPlanEntries.mealPlanId, plan.id))
    .orderBy(asc(mealPlanEntries.dayOfWeek));

  return { plan, entries };
}

/** Flat day/meal/title triples — what the AI concierge needs to avoid clashes. */
export async function getWeekMealSlots(
  ctx: HouseholdContext,
  weekStartDate: string
): Promise<{ dayOfWeek: number; mealType: string; recipeTitle: string }[]> {
  return db
    .select({
      dayOfWeek: mealPlanEntries.dayOfWeek,
      mealType: mealPlanEntries.mealType,
      recipeTitle: recipes.title,
    })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
    .where(
      and(
        eq(mealPlans.householdId, ctx.householdId),
        eq(mealPlans.weekStartDate, weekStartDate)
      )
    );
}

// --- Entry writes -----------------------------------------------------------

export async function addEntry(
  ctx: HouseholdContext,
  weekStartDate: string,
  recipeId: string,
  dayOfWeek: number,
  mealType: MealType
): Promise<string> {
  assertDayOfWeek(dayOfWeek);
  assertMealType(mealType);

  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, ctx.householdId)))
    .limit(1);

  if (!recipe) throw new MealPlanValidationError("Recipe not found");

  const plan = await getOrCreatePlan(ctx, weekStartDate);

  const [entry] = await db
    .insert(mealPlanEntries)
    .values({ mealPlanId: plan.id, recipeId, dayOfWeek, mealType })
    .returning({ id: mealPlanEntries.id });

  return entry!.id;
}

export async function moveEntry(
  ctx: HouseholdContext,
  entryId: string,
  newDayOfWeek: number
): Promise<void> {
  assertDayOfWeek(newDayOfWeek);
  await assertEntryOwned(entryId, ctx.householdId);

  await db
    .update(mealPlanEntries)
    .set({ dayOfWeek: newDayOfWeek })
    .where(eq(mealPlanEntries.id, entryId));
}

export async function changeEntryType(
  ctx: HouseholdContext,
  entryId: string,
  newMealType: string
): Promise<void> {
  assertMealType(newMealType);
  await assertEntryOwned(entryId, ctx.householdId);

  await db
    .update(mealPlanEntries)
    .set({ mealType: newMealType })
    .where(eq(mealPlanEntries.id, entryId));
}

export async function removeEntry(
  ctx: HouseholdContext,
  entryId: string
): Promise<void> {
  await assertEntryOwned(entryId, ctx.householdId);

  await db.delete(mealPlanEntries).where(eq(mealPlanEntries.id, entryId));
}

export async function updateEntryServings(
  ctx: HouseholdContext,
  entryId: string,
  servings: number | null
): Promise<void> {
  if (servings !== null && (servings <= 0 || !isFinite(servings))) {
    throw new MealPlanValidationError("servings must be a positive number or null");
  }

  await assertEntryOwned(entryId, ctx.householdId);

  await db
    .update(mealPlanEntries)
    .set({ servings: servings !== null ? String(servings) : null })
    .where(eq(mealPlanEntries.id, entryId));
}

// --- AI-generated plans -----------------------------------------------------

export async function addAiGeneratedPlan(
  ctx: PushContext,
  weekStartDate: string,
  slots: MealPlanSlot[],
  memberIds: string[] = []
): Promise<{ planId: string; entryCount: number }> {
  const plan = await getOrCreatePlan(ctx, weekStartDate);

  // Derive a servings count from who's eating, scaled by age. Null = use the
  // recipe's own base servings (i.e. no members were selected).
  const servings = await servingsForMembers(ctx.householdId, memberIds);

  // Verify any proposed existing recipe IDs actually belong to this household
  const proposedIds = slots.map((s) => s.recipeId).filter((id): id is string => !!id);
  const verifiedIds =
    proposedIds.length > 0
      ? await db
          .select({ id: recipes.id })
          .from(recipes)
          .where(
            and(
              eq(recipes.householdId, ctx.householdId),
              inArray(recipes.id, proposedIds)
            )
          )
          .then((rows) => new Set(rows.map((r) => r.id)))
      : new Set<string>();

  // For library slots use the existing recipe; for new slots create a stub
  const resolvedSlots = await Promise.all(
    slots.map(async (slot) => {
      if (slot.recipeId && verifiedIds.has(slot.recipeId)) {
        return {
          dayOfWeek: slot.dayOfWeek,
          mealType: slot.mealType,
          recipeId: slot.recipeId,
        };
      }
      const [recipe] = await db
        .insert(recipes)
        .values({
          householdId: ctx.householdId,
          createdById: ctx.memberId,
          title: slot.title,
          description: slot.description,
          cuisine: slot.cuisine,
          difficulty: slot.difficulty,
          isAiGenerated: true,
        })
        .returning({ id: recipes.id });
      return {
        dayOfWeek: slot.dayOfWeek,
        mealType: slot.mealType,
        recipeId: recipe!.id,
      };
    })
  );

  const insertedEntries = await db
    .insert(mealPlanEntries)
    .values(
      resolvedSlots.map((r) => ({
        mealPlanId: plan.id,
        recipeId: r.recipeId,
        dayOfWeek: r.dayOfWeek,
        mealType: r.mealType as MealType,
        servings: servings !== null ? String(servings) : null,
      }))
    )
    .returning({ id: mealPlanEntries.id });

  await notifyHousehold(
    ctx.householdId,
    {
      title: "🍽️ Meal plan ready",
      body: `${ctx.actorName} added this week's meal plan`,
      url: "/meal-plan",
    },
    { excludeAutheliaUser: ctx.user.username }
  );

  return { planId: plan.id, entryCount: insertedEntries.length };
}

// --- Shopping generation ----------------------------------------------------

/**
 * Outcome of a shopping-list add. `skipped` names the ingredients the pantry
 * already covers so the UI can say what happened instead of failing silently.
 */
export type ShoppingAddResult = {
  added: number;
  merged: number;
  skipped: string[];
};

/**
 * One ingredient ready to go onto the list: amount already scaled, and every
 * contributing recipe recorded (the first is the primary link).
 */
type PendingIngredient = {
  ingredientName: string;
  amount: number | null;
  unit: string | null;
  notes: string | null;
  recipeIds: string[];
};

/**
 * The write half shared by the single-entry and whole-week paths: skip what the
 * pantry covers, merge into a matching unchecked line, otherwise append.
 *
 * `forceInclude` is an override pass — when given, ONLY the named ingredients
 * are processed, because the rest already went on the list in the first pass
 * and re-running them would double their amounts.
 *
 * Note the existing-items snapshot is taken once, before the loop: two lines
 * for the same ingredient within one pass each insert their own row rather than
 * merging into each other. That is long-standing behaviour, preserved here.
 */
async function applyToShoppingList(
  ctx: ActorContext,
  pending: PendingIngredient[],
  exclusions: PantryExclusions,
  forceInclude: Set<string> | null
): Promise<{ result: ShoppingAddResult; listId: string }> {
  const result: ShoppingAddResult = { added: 0, merged: 0, skipped: [] };

  const list = await ensureActiveList(ctx);

  const existingItems = await db
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

  const maxPos = existingItems.length
    ? Math.max(...existingItems.map((i) => i.position))
    : -1;
  let posCounter = maxPos + 1;

  for (const ing of pending) {
    const normalName = ing.ingredientName.toLowerCase().trim();

    if (forceInclude && !forceInclude.has(normalName)) continue;

    // Skip staples and fully-stocked ingredients. Recorded, not silently
    // dropped, so the caller can offer "add anyway".
    if (
      !forceInclude &&
      isCoveredByPantry(exclusions, ing.ingredientName, ing.amount, ing.unit)
    ) {
      result.skipped.push(ing.ingredientName);
      continue;
    }

    const scaledAmountStr =
      ing.amount !== null ? (Math.round(ing.amount * 1000) / 1000).toString() : null;

    const match = existingItems.find(
      (e) =>
        !e.isChecked &&
        e.ingredientName.toLowerCase().trim() === normalName &&
        e.unit === ing.unit
    );

    const sourceRows = ing.recipeIds.map((recipeId) => ({ recipeId }));

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
        .values(sourceRows.map((r) => ({ ...r, itemId: match.id })))
        .onConflictDoNothing();
      result.merged++;
    } else {
      const [inserted] = await db
        .insert(shoppingListItems)
        .values({
          listId: list.id,
          recipeId: ing.recipeIds[0]!,
          ingredientName: ing.ingredientName,
          amount: scaledAmountStr,
          unit: ing.unit,
          notes: ing.notes,
          position: posCounter++,
        })
        .returning({ id: shoppingListItems.id });
      await db
        .insert(shoppingListItemRecipes)
        .values(sourceRows.map((r) => ({ ...r, itemId: inserted!.id })))
        .onConflictDoNothing();
      result.added++;
    }
  }

  return { result, listId: list.id };
}

function toForceIncludeSet(forceInclude?: string[]): Set<string> | null {
  return forceInclude?.length
    ? new Set(forceInclude.map((n) => n.toLowerCase().trim()))
    : null;
}

/**
 * `forceInclude` names ingredients to add despite pantry coverage. When given,
 * only those ingredients are processed — see applyToShoppingList.
 */
export async function addEntryToShoppingList(
  ctx: ActorContext,
  entryId: string,
  opts?: { forceInclude?: string[] }
): Promise<ShoppingAddResult> {
  const empty: ShoppingAddResult = { added: 0, merged: 0, skipped: [] };

  const [entry] = await db
    .select({
      recipeId: mealPlanEntries.recipeId,
      entryServings: mealPlanEntries.servings,
      baseServings: recipes.servings,
    })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
    .where(
      and(eq(mealPlanEntries.id, entryId), eq(mealPlans.householdId, ctx.householdId))
    )
    .limit(1);

  if (!entry) return empty;

  const ingredients = await db
    .select({
      ingredientName: recipeIngredients.ingredientName,
      amount: recipeIngredients.amount,
      unit: recipeIngredients.unit,
    })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, entry.recipeId));

  if (!ingredients.length) return empty;

  const baseServings = entry.baseServings ? parseFloat(entry.baseServings) : null;
  const entryServings = entry.entryServings ? parseFloat(entry.entryServings) : null;
  const scale =
    entryServings && baseServings && baseServings > 0
      ? entryServings / baseServings
      : 1;

  const pending: PendingIngredient[] = ingredients.map((ing) => {
    const rawNum = ing.amount !== null ? parseFloat(ing.amount) : NaN;
    const isNumeric = !isNaN(rawNum);
    return {
      ingredientName: ing.ingredientName,
      amount: isNumeric ? rawNum * scale : null,
      unit: ing.unit,
      notes: !isNumeric && ing.amount ? ing.amount : null,
      recipeIds: [entry.recipeId],
    };
  });

  const exclusions = await getPantryExclusions(ctx.householdId);
  const { result } = await applyToShoppingList(
    ctx,
    pending,
    exclusions,
    toForceIncludeSet(opts?.forceInclude)
  );

  // Only flag the entry when something actually reached the list. Marking it
  // after a whole-recipe pantry skip is what made this look like a silent
  // failure: the badge said "On list" while the list was unchanged.
  if (result.added + result.merged > 0) {
    await db
      .update(mealPlanEntries)
      .set({ addedToShoppingListAt: new Date() })
      .where(eq(mealPlanEntries.id, entryId));
  }

  return result;
}

export async function generateShoppingFromWeek(
  ctx: PushContext,
  mealPlanId: string,
  opts?: { forceInclude?: string[] }
): Promise<ShoppingAddResult> {
  const empty: ShoppingAddResult = { added: 0, merged: 0, skipped: [] };

  await assertPlanOwned(mealPlanId, ctx.householdId);

  const forceInclude = toForceIncludeSet(opts?.forceInclude);

  // Only entries not yet added — re-generating must not duplicate meals that
  // are already on the list (their per-entry "Add again" covers deliberate
  // re-adds). An override pass ignores the flag: the first pass just set it,
  // and the skipped ingredients still need to come from the same entries.
  const entries = await db
    .select({
      recipeId: mealPlanEntries.recipeId,
      servings: mealPlanEntries.servings,
    })
    .from(mealPlanEntries)
    .where(
      forceInclude
        ? eq(mealPlanEntries.mealPlanId, mealPlanId)
        : and(
            eq(mealPlanEntries.mealPlanId, mealPlanId),
            isNull(mealPlanEntries.addedToShoppingListAt)
          )
    );

  if (!entries.length) return empty;

  const recipeIds = [...new Set(entries.map((e) => e.recipeId))];

  const recipeBaseServings = await db
    .select({ id: recipes.id, servings: recipes.servings })
    .from(recipes)
    .where(
      and(inArray(recipes.id, recipeIds), eq(recipes.householdId, ctx.householdId))
    );

  const baseServingsMap = new Map(
    recipeBaseServings.map((r) => [r.id, r.servings ? parseFloat(r.servings) : null])
  );

  const allIngredients = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientName: recipeIngredients.ingredientName,
      amount: recipeIngredients.amount,
      unit: recipeIngredients.unit,
    })
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id))
    .where(
      and(
        inArray(recipeIngredients.recipeId, recipeIds),
        eq(recipes.householdId, ctx.householdId)
      )
    );

  const ingredientsByRecipe = new Map<string, typeof allIngredients>();
  for (const ing of allIngredients) {
    const list = ingredientsByRecipe.get(ing.recipeId) ?? [];
    list.push(ing);
    ingredientsByRecipe.set(ing.recipeId, list);
  }

  // Accumulate scaled ingredient totals across every entry in the week, keyed
  // on name + unit so "200g flour" from two recipes becomes one 400g line.
  const totals = new Map<string, PendingIngredient>();

  for (const entry of entries) {
    const baseServings = baseServingsMap.get(entry.recipeId) ?? null;
    const entryServings = entry.servings ? parseFloat(entry.servings) : null;
    const scale =
      entryServings && baseServings && baseServings > 0
        ? entryServings / baseServings
        : 1;

    for (const ing of ingredientsByRecipe.get(entry.recipeId) ?? []) {
      const key = `${ing.ingredientName.toLowerCase().trim()}||${ing.unit ?? ""}`;
      const rawNum = ing.amount !== null ? parseFloat(ing.amount) : NaN;
      const isNumeric = !isNaN(rawNum);

      const existing = totals.get(key);
      if (existing) {
        totals.set(key, {
          ingredientName: existing.ingredientName,
          amount:
            existing.amount !== null && isNumeric
              ? existing.amount + rawNum * scale
              : existing.amount,
          unit: ing.unit,
          notes: existing.notes,
          recipeIds: existing.recipeIds.includes(ing.recipeId)
            ? existing.recipeIds
            : [...existing.recipeIds, ing.recipeId],
        });
      } else {
        totals.set(key, {
          // First occurrence wins the canonical casing for the line.
          ingredientName: ing.ingredientName,
          amount: isNumeric ? rawNum * scale : null,
          unit: ing.unit,
          notes: !isNumeric && ing.amount ? ing.amount : null,
          recipeIds: [ing.recipeId],
        });
      }
    }
  }

  const exclusions = await getPantryExclusions(ctx.householdId);
  const { result } = await applyToShoppingList(
    ctx,
    [...totals.values()],
    exclusions,
    forceInclude
  );

  // As with the single-entry add: don't claim the week is on the list when the
  // pantry swallowed every ingredient.
  if (result.added + result.merged > 0) {
    await db
      .update(mealPlanEntries)
      .set({ addedToShoppingListAt: new Date() })
      .where(
        and(
          eq(mealPlanEntries.mealPlanId, mealPlanId),
          isNull(mealPlanEntries.addedToShoppingListAt)
        )
      );

    await notifyHousehold(
      ctx.householdId,
      {
        title: "🛒 Shopping list ready",
        body: `${ctx.actorName} generated this week's shopping list`,
        url: "/shopping",
      },
      { excludeAutheliaUser: ctx.user.username }
    );
  }

  return result;
}
