"use server";

import { db } from "@/lib/db";
import {
  mealPlans,
  mealPlanEntries,
  recipes,
  recipeIngredients,
  shoppingLists,
  shoppingListItems,
} from "@dishes/db/schema";
import type { MealPlanSlot } from "./ai";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

type MealType = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";

async function getOrCreatePlan(
  householdId: string,
  memberId: string,
  weekStartDate: string
) {
  const [existing] = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(
      and(
        eq(mealPlans.householdId, householdId),
        eq(mealPlans.weekStartDate, weekStartDate)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(mealPlans)
    .values({
      householdId,
      createdById: memberId,
      weekStartDate,
      status: "active",
    })
    .returning({ id: mealPlans.id });

  return created!;
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
  slots: MealPlanSlot[]
): Promise<{ success?: boolean; error?: string; debug?: Record<string, unknown> }> {
  const debug: Record<string, unknown> = { weekStartDate, slotsReceived: slots.length };
  try {
    const user = await getAutheliaUser();
    const { householdId, memberId } = await requireHousehold(user);
    debug.householdId = householdId;
    debug.memberId = memberId;

    const plan = await getOrCreatePlan(householdId, memberId, weekStartDate);
    debug.planId = plan.id;

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
      }))
    ).returning();
    debug.insertedEntries = insertedEntries;

    console.log("[addAiGeneratedMealPlan] debug:", JSON.stringify(debug, null, 2));

    revalidatePath("/meal-plan");
    revalidatePath("/recipes");
    return { success: true, debug };
  } catch (err) {
    debug.error = err instanceof Error ? err.message : String(err);
    console.error("[addAiGeneratedMealPlan] error:", JSON.stringify(debug, null, 2));
    return { error: err instanceof Error ? err.message : "Failed to add meal plan.", debug };
  }
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

  const entries = await db
    .select({
      recipeId: mealPlanEntries.recipeId,
      servings: mealPlanEntries.servings,
    })
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.mealPlanId, mealPlanId));

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

  // Accumulate scaled ingredient totals across all meal plan entries
  type Accumulated = { amount: number | null; unit: string | null; notes: string | null };
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
        });
      } else {
        totals.set(key, {
          amount: isNumeric ? rawNum * scale : null,
          unit: ing.unit,
          notes: !isNumeric && ing.amount ? ing.amount : null,
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
    })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId));

  const maxPos = existingItems.length
    ? Math.max(...existingItems.map((i) => i.position))
    : -1;
  let posCounter = maxPos + 1;

  for (const [key, total] of totals) {
    const ingredientName = nameMap.get(key) ?? key.split("||")[0]!;
    const normalName = ingredientName.toLowerCase().trim();
    const match = existingItems.find(
      (e) =>
        e.ingredientName.toLowerCase().trim() === normalName &&
        e.unit === total.unit
    );

    const scaledAmountStr =
      total.amount !== null
        ? (Math.round(total.amount * 1000) / 1000).toString()
        : null;

    if (match && match.amount !== null && scaledAmountStr !== null) {
      const newAmount = (
        Math.round((parseFloat(match.amount) + parseFloat(scaledAmountStr)) * 1000) / 1000
      ).toString();
      await db
        .update(shoppingListItems)
        .set({ amount: newAmount })
        .where(eq(shoppingListItems.id, match.id));
    } else {
      await db.insert(shoppingListItems).values({
        listId,
        ingredientName,
        amount: scaledAmountStr,
        unit: total.unit,
        notes: total.notes,
        position: posCounter++,
      });
    }
  }

  revalidatePath("/shopping");
  revalidatePath("/meal-plan");
}
