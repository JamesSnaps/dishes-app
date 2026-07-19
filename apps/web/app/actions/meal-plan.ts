"use server";

import { db } from "@/lib/db";
import {
  mealPlans,
  mealPlanEntries,
  recipes,
  recipeIngredients,
  shoppingLists,
  shoppingListItems,
  shoppingListItemRecipes,
  householdMembers,
} from "@dishes/db/schema";
import type { MealPlanSlot } from "./ai";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { notifyHousehold } from "@/lib/push";
import { getPantryExclusions, isCoveredByPantry } from "@/lib/pantry-exclusions";

type MealType = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";

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

// Sum appetite factors for the selected members and round to a whole number of
// servings (floor of 1). Returns null when no members are selected so callers
// fall back to the recipe's base servings.
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

async function getOrCreatePlan(
  householdId: string,
  memberId: string,
  weekStartDate: string
) {
  const [row] = await db
    .insert(mealPlans)
    .values({ householdId, createdById: memberId, weekStartDate, status: "active" })
    .onConflictDoUpdate({
      target: [mealPlans.householdId, mealPlans.weekStartDate],
      set: { updatedAt: sql`now()` },
    })
    .returning({ id: mealPlans.id });

  return row!;
}

export async function addMealEntry(
  weekStartDate: string,
  recipeId: string,
  dayOfWeek: number,
  mealType: MealType
) {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error("dayOfWeek must be an integer between 0 (Mon) and 6 (Sun)");
  }
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) throw new Error("Recipe not found");

  const plan = await getOrCreatePlan(householdId, memberId, weekStartDate);

  await db
    .insert(mealPlanEntries)
    .values({ mealPlanId: plan.id, recipeId, dayOfWeek, mealType });

  revalidatePath("/meal-plan");
}

export async function moveMealEntry(entryId: string, newDayOfWeek: number) {
  if (!Number.isInteger(newDayOfWeek) || newDayOfWeek < 0 || newDayOfWeek > 6) {
    throw new Error("dayOfWeek must be between 0 and 6");
  }
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  // Single query verifies the entry exists and belongs to this household atomically
  const [entry] = await db
    .select({ id: mealPlanEntries.id })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .where(
      and(
        eq(mealPlanEntries.id, entryId),
        eq(mealPlans.householdId, householdId)
      )
    )
    .limit(1);

  if (!entry) return;

  await db
    .update(mealPlanEntries)
    .set({ dayOfWeek: newDayOfWeek })
    .where(eq(mealPlanEntries.id, entryId));

  revalidatePath("/meal-plan");
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "dessert", "snack"] as const;
type MealTypeValue = (typeof MEAL_TYPES)[number];

export async function changeMealEntryType(entryId: string, newMealType: string) {
  if (!MEAL_TYPES.includes(newMealType as MealTypeValue)) {
    throw new Error("Invalid meal type");
  }
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  // Single query verifies the entry exists and belongs to this household atomically
  const [entry] = await db
    .select({ id: mealPlanEntries.id })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .where(
      and(
        eq(mealPlanEntries.id, entryId),
        eq(mealPlans.householdId, householdId)
      )
    )
    .limit(1);

  if (!entry) return;

  await db
    .update(mealPlanEntries)
    .set({ mealType: newMealType as MealTypeValue })
    .where(eq(mealPlanEntries.id, entryId));

  revalidatePath("/meal-plan");
}

export async function removeMealEntry(entryId: string) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  // Single query verifies the entry exists and belongs to this household atomically
  const [entry] = await db
    .select({ id: mealPlanEntries.id })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .where(
      and(
        eq(mealPlanEntries.id, entryId),
        eq(mealPlans.householdId, householdId)
      )
    )
    .limit(1);

  if (!entry) return;

  await db.delete(mealPlanEntries).where(eq(mealPlanEntries.id, entryId));

  revalidatePath("/meal-plan");
}

export async function addAiGeneratedMealPlan(
  weekStartDate: string,
  slots: MealPlanSlot[],
  memberIds: string[] = []
): Promise<{ success?: boolean; error?: string; debug?: Record<string, unknown> }> {
  const debug: Record<string, unknown> = { weekStartDate, slotsReceived: slots.length };
  try {
    const user = await getAutheliaUser();
    const { householdId, memberId } = await requireHousehold(user);
    debug.householdId = householdId;
    debug.memberId = memberId;

    const plan = await getOrCreatePlan(householdId, memberId, weekStartDate);
    debug.planId = plan.id;

    // Derive a servings count from who's eating, scaled by age. Null = use the
    // recipe's own base servings (i.e. no members were selected).
    const servings = await servingsForMembers(householdId, memberIds);
    debug.memberIds = memberIds;
    debug.servings = servings;

    // Verify any proposed existing recipe IDs actually belong to this household
    const proposedIds = slots.map((s) => s.recipeId).filter((id): id is string => !!id);
    const verifiedIds = proposedIds.length > 0
      ? await db
          .select({ id: recipes.id })
          .from(recipes)
          .where(and(eq(recipes.householdId, householdId), inArray(recipes.id, proposedIds)))
          .then((rows) => new Set(rows.map((r) => r.id)))
      : new Set<string>();
    debug.proposedRecipeIds = proposedIds;
    debug.verifiedRecipeIds = [...verifiedIds];

    // For library slots use the existing recipe; for new slots create a stub
    const resolvedSlots = await Promise.all(
      slots.map(async (slot) => {
        if (slot.recipeId && verifiedIds.has(slot.recipeId)) {
          return { dayOfWeek: slot.dayOfWeek, mealType: slot.mealType, recipeId: slot.recipeId };
        }
        const [recipe] = await db
          .insert(recipes)
          .values({
            householdId,
            createdById: memberId,
            title: slot.title,
            description: slot.description,
            cuisine: slot.cuisine,
            difficulty: slot.difficulty,
            isAiGenerated: true,
          })
          .returning({ id: recipes.id });
        return { dayOfWeek: slot.dayOfWeek, mealType: slot.mealType, recipeId: recipe!.id };
      })
    );
    debug.resolvedSlots = resolvedSlots;

    const insertedEntries = await db.insert(mealPlanEntries).values(
      resolvedSlots.map((r) => ({
        mealPlanId: plan.id,
        recipeId: r.recipeId,
        dayOfWeek: r.dayOfWeek,
        mealType: r.mealType as MealType,
        servings: servings !== null ? String(servings) : null,
      }))
    ).returning();
    debug.insertedEntries = insertedEntries;

    console.log("[addAiGeneratedMealPlan] debug:", JSON.stringify(debug, null, 2));

    revalidatePath("/meal-plan");
    revalidatePath("/recipes");

    await notifyHousehold(
      householdId,
      {
        title: "🍽️ Meal plan ready",
        body: `${user.displayName} added this week's meal plan`,
        url: "/meal-plan",
      },
      { excludeAutheliaUser: user.username }
    );

    return { success: true, debug };
  } catch (err) {
    debug.error = err instanceof Error ? err.message : String(err);
    console.error("[addAiGeneratedMealPlan] error:", JSON.stringify(debug, null, 2));
    return { error: err instanceof Error ? err.message : "Failed to add meal plan.", debug };
  }
}

export async function updateMealEntryServings(entryId: string, servings: number | null) {
  if (servings !== null && (servings <= 0 || !isFinite(servings))) return;

  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [entry] = await db
    .select({ id: mealPlanEntries.id })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .where(and(eq(mealPlanEntries.id, entryId), eq(mealPlans.householdId, householdId)))
    .limit(1);

  if (!entry) return;

  await db
    .update(mealPlanEntries)
    .set({ servings: servings !== null ? String(servings) : null })
    .where(eq(mealPlanEntries.id, entryId));

  revalidatePath("/meal-plan");
}

export async function addMealEntryToShoppingList(entryId: string) {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const [entry] = await db
    .select({
      recipeId: mealPlanEntries.recipeId,
      entryServings: mealPlanEntries.servings,
      recipeTitle: recipes.title,
      baseServings: recipes.servings,
    })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
    .where(
      and(
        eq(mealPlanEntries.id, entryId),
        eq(mealPlans.householdId, householdId)
      )
    )
    .limit(1);

  if (!entry) return;

  const ingredients = await db
    .select({
      ingredientName: recipeIngredients.ingredientName,
      amount: recipeIngredients.amount,
      unit: recipeIngredients.unit,
    })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, entry.recipeId));

  if (!ingredients.length) return;

  const exclusions = await getPantryExclusions(householdId);

  const baseServings = entry.baseServings ? parseFloat(entry.baseServings) : null;
  const entryServings = entry.entryServings ? parseFloat(entry.entryServings) : null;
  const scale =
    entryServings && baseServings && baseServings > 0
      ? entryServings / baseServings
      : 1;

  const [existingList] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.status, "active")))
    .limit(1);

  let listId: string;
  if (existingList) {
    listId = existingList.id;
  } else {
    const name = `Shopping – ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
    const [newList] = await db
      .insert(shoppingLists)
      .values({ householdId, createdById: memberId, name })
      .returning({ id: shoppingLists.id });
    listId = newList!.id;
  }

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
    .where(eq(shoppingListItems.listId, listId));

  const maxPos = existingItems.length
    ? Math.max(...existingItems.map((i) => i.position))
    : -1;
  let posCounter = maxPos + 1;

  for (const ing of ingredients) {
    const normalName = ing.ingredientName.toLowerCase().trim();
    const rawNum = ing.amount !== null ? parseFloat(ing.amount) : NaN;
    const isNumeric = !isNaN(rawNum);

    // Skip staples and fully-stocked ingredients, matching generateFromRecipe
    if (isCoveredByPantry(exclusions, ing.ingredientName, isNumeric ? rawNum * scale : null, ing.unit)) {
      continue;
    }

    const scaledAmountStr =
      isNumeric ? (Math.round(rawNum * scale * 1000) / 1000).toString() : null;

    const match = existingItems.find(
      (e) =>
        !e.isChecked &&
        e.ingredientName.toLowerCase().trim() === normalName &&
        e.unit === ing.unit
    );

    if (match && match.amount !== null && scaledAmountStr !== null) {
      const newAmount = (
        Math.round((parseFloat(match.amount) + parseFloat(scaledAmountStr)) * 1000) / 1000
      ).toString();
      await db
        .update(shoppingListItems)
        .set({ amount: newAmount })
        .where(eq(shoppingListItems.id, match.id));
      await db
        .insert(shoppingListItemRecipes)
        .values({ itemId: match.id, recipeId: entry.recipeId })
        .onConflictDoNothing();
    } else {
      const [inserted] = await db
        .insert(shoppingListItems)
        .values({
          listId,
          recipeId: entry.recipeId,
          ingredientName: ing.ingredientName,
          amount: scaledAmountStr,
          unit: ing.unit,
          notes: !isNumeric && ing.amount ? ing.amount : null,
          position: posCounter++,
        })
        .returning({ id: shoppingListItems.id });
      await db
        .insert(shoppingListItemRecipes)
        .values({ itemId: inserted!.id, recipeId: entry.recipeId })
        .onConflictDoNothing();
    }
  }

  await db
    .update(mealPlanEntries)
    .set({ addedToShoppingListAt: new Date() })
    .where(eq(mealPlanEntries.id, entryId));

  revalidatePath("/shopping");
  revalidatePath("/meal-plan");
}

export async function getWeekMealSlots(weekStartDate: string): Promise<{ dayOfWeek: number; mealType: string; recipeTitle: string }[]> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const rows = await db
    .select({
      dayOfWeek: mealPlanEntries.dayOfWeek,
      mealType: mealPlanEntries.mealType,
      recipeTitle: recipes.title,
    })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
    .where(and(eq(mealPlans.householdId, householdId), eq(mealPlans.weekStartDate, weekStartDate)));

  return rows;
}

export async function generateShoppingFromWeek(mealPlanId: string) {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const [plan] = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(
      and(
        eq(mealPlans.id, mealPlanId),
        eq(mealPlans.householdId, householdId)
      )
    )
    .limit(1);

  if (!plan) throw new Error("Meal plan not found");

  // Only entries not yet added — re-generating must not duplicate meals that
  // are already on the list (their per-entry "Add again" covers deliberate re-adds)
  const entries = await db
    .select({
      recipeId: mealPlanEntries.recipeId,
      servings: mealPlanEntries.servings,
    })
    .from(mealPlanEntries)
    .where(
      and(
        eq(mealPlanEntries.mealPlanId, mealPlanId),
        isNull(mealPlanEntries.addedToShoppingListAt)
      )
    );

  if (!entries.length) return;

  const recipeIds = [...new Set(entries.map((e) => e.recipeId))];

  const recipeBaseServings = await db
    .select({ id: recipes.id, servings: recipes.servings })
    .from(recipes)
    .where(and(inArray(recipes.id, recipeIds), eq(recipes.householdId, householdId)));

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
    .where(and(inArray(recipeIngredients.recipeId, recipeIds), eq(recipes.householdId, householdId)));

  const ingredientsByRecipe = new Map<string, typeof allIngredients>();
  for (const ing of allIngredients) {
    const list = ingredientsByRecipe.get(ing.recipeId) ?? [];
    list.push(ing);
    ingredientsByRecipe.set(ing.recipeId, list);
  }

  // Accumulate scaled ingredient totals across all meal plan entries.
  // recipeIds keeps every contributing recipe (first one = primary for linking).
  type Accumulated = { amount: number | null; unit: string | null; notes: string | null; recipeIds: string[] };
  const totals = new Map<string, Accumulated>();

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
          amount: existing.amount !== null && isNumeric ? existing.amount + rawNum * scale : existing.amount,
          unit: ing.unit,
          notes: existing.notes,
          recipeIds: existing.recipeIds.includes(ing.recipeId)
            ? existing.recipeIds
            : [...existing.recipeIds, ing.recipeId],
        });
      } else {
        totals.set(key, {
          amount: isNumeric ? rawNum * scale : null,
          unit: ing.unit,
          notes: !isNumeric && ing.amount ? ing.amount : null,
          recipeIds: [ing.recipeId],
        });
      }
    }
  }

  // Rebuild a flat list using canonical ingredient names
  const nameMap = new Map<string, string>();
  for (const ing of allIngredients) {
    const key = `${ing.ingredientName.toLowerCase().trim()}||${ing.unit ?? ""}`;
    if (!nameMap.has(key)) nameMap.set(key, ing.ingredientName);
  }

  const [existingList] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.householdId, householdId),
        eq(shoppingLists.status, "active")
      )
    )
    .limit(1);

  let listId: string;
  if (existingList) {
    listId = existingList.id;
  } else {
    const name = `Shopping – ${new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    })}`;
    const [newList] = await db
      .insert(shoppingLists)
      .values({ householdId, createdById: memberId, name })
      .returning({ id: shoppingLists.id });
    listId = newList!.id;
  }

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
    .where(eq(shoppingListItems.listId, listId));

  const maxPos = existingItems.length
    ? Math.max(...existingItems.map((i) => i.position))
    : -1;
  let posCounter = maxPos + 1;

  const exclusions = await getPantryExclusions(householdId);

  for (const [key, total] of totals) {
    const ingredientName = nameMap.get(key) ?? key.split("||")[0]!;
    const normalName = ingredientName.toLowerCase().trim();

    // Skip staples and ingredients the pantry stock already covers for the
    // whole week's aggregated amount, matching generateFromRecipe
    if (isCoveredByPantry(exclusions, ingredientName, total.amount, total.unit)) {
      continue;
    }
    const match = existingItems.find(
      (e) =>
        !e.isChecked &&
        e.ingredientName.toLowerCase().trim() === normalName &&
        e.unit === total.unit
    );

    const scaledAmountStr =
      total.amount !== null
        ? (Math.round(total.amount * 1000) / 1000).toString()
        : null;

    const sourceRows = total.recipeIds.map((recipeId) => ({ recipeId }));

    if (match && match.amount !== null && scaledAmountStr !== null) {
      const newAmount = (
        Math.round((parseFloat(match.amount) + parseFloat(scaledAmountStr)) * 1000) / 1000
      ).toString();
      await db
        .update(shoppingListItems)
        .set({ amount: newAmount })
        .where(eq(shoppingListItems.id, match.id));
      await db
        .insert(shoppingListItemRecipes)
        .values(sourceRows.map((r) => ({ ...r, itemId: match.id })))
        .onConflictDoNothing();
    } else {
      const [inserted] = await db
        .insert(shoppingListItems)
        .values({
          listId,
          recipeId: total.recipeIds[0]!,
          ingredientName,
          amount: scaledAmountStr,
          unit: total.unit,
          notes: total.notes,
          position: posCounter++,
        })
        .returning({ id: shoppingListItems.id });
      await db
        .insert(shoppingListItemRecipes)
        .values(sourceRows.map((r) => ({ ...r, itemId: inserted!.id })))
        .onConflictDoNothing();
    }
  }

  await db
    .update(mealPlanEntries)
    .set({ addedToShoppingListAt: new Date() })
    .where(
      and(
        eq(mealPlanEntries.mealPlanId, mealPlanId),
        isNull(mealPlanEntries.addedToShoppingListAt)
      )
    );

  revalidatePath("/shopping");
  revalidatePath("/meal-plan");

  await notifyHousehold(
    householdId,
    {
      title: "🛒 Shopping list ready",
      body: `${user.displayName} generated this week's shopping list`,
      url: "/shopping",
    },
    { excludeAutheliaUser: user.username }
  );
}
