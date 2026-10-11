/**
 * Saved meals — reusable combinations of recipes ("Sunday Roast": roast
 * chicken, roast potatoes, cabbage, gravy).
 *
 * A saved meal is a template. Putting one on the plan copies its components
 * into a planned meal group (`meal-plan.ts#addGroup`), so swapping the meat for
 * one week never changes the saved meal; "update saved meal" writes a planned
 * group's current recipes back deliberately.
 *
 * Same rules as the other services: takes a context, scopes every query by
 * householdId, never redirects or calls revalidatePath.
 */

import { db } from "@/lib/db";
import { runInTransaction } from "@dishes/db";
import { meals, mealComponents, recipes } from "@dishes/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { MEAL_ROLES, isMealRole, type MealRole, type MealType } from "@dishes/shared";
import type { HouseholdContext } from "@/lib/session";
import {
  assertMealType,
  getGroupComponents,
  setGroupSourceMeal,
} from "@/lib/services/meal-plan";

export class MealNotFoundError extends Error {
  constructor() {
    super("Saved meal not found");
    this.name = "MealNotFoundError";
  }
}

export class MealValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MealValidationError";
  }
}

export type MealComponentInput = { recipeId: string; role: MealRole };

export type SavedMealComponent = {
  id: string;
  role: MealRole;
  position: number;
  recipe: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    imageUrl: string | null;
    prepTimeMinutes: number | null;
    cookTimeMinutes: number | null;
  };
};

export type SavedMeal = {
  id: string;
  title: string;
  notes: string | null;
  defaultMealType: MealType;
  components: SavedMealComponent[];
};

export type SaveMealInput = {
  title: string;
  notes?: string | null;
  defaultMealType?: MealType;
  components: MealComponentInput[];
};

function cleanTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new MealValidationError("A meal needs a name");
  if (t.length > 200) throw new MealValidationError("Meal name is too long");
  return t;
}

async function validateComponents(
  ctx: HouseholdContext,
  components: MealComponentInput[]
): Promise<void> {
  if (!components.length) throw new MealValidationError("A meal needs at least one recipe");
  for (const c of components) {
    if (!isMealRole(c.role)) throw new MealValidationError("Invalid meal role");
  }
  const ids = [...new Set(components.map((c) => c.recipeId))];
  const owned = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.householdId, ctx.householdId), inArray(recipes.id, ids)));
  if (owned.length !== ids.length) throw new MealValidationError("Recipe not found");
}

async function assertMealOwned(ctx: HouseholdContext, mealId: string) {
  const [meal] = await db
    .select({ id: meals.id })
    .from(meals)
    .where(and(eq(meals.id, mealId), eq(meals.householdId, ctx.householdId)))
    .limit(1);
  if (!meal) throw new MealNotFoundError();
  return meal;
}

/** Display order: by role (main first), then the order they were saved in. */
function byRoleThenPosition(a: SavedMealComponent, b: SavedMealComponent): number {
  const r = MEAL_ROLES.indexOf(a.role) - MEAL_ROLES.indexOf(b.role);
  return r !== 0 ? r : a.position - b.position;
}

async function replaceComponents(mealId: string, components: MealComponentInput[]) {
  await db.delete(mealComponents).where(eq(mealComponents.mealId, mealId));
  await db.insert(mealComponents).values(
    components.map((c, i) => ({ mealId, recipeId: c.recipeId, role: c.role, position: i }))
  );
}

// --- Reads ------------------------------------------------------------------

export async function listMeals(ctx: HouseholdContext): Promise<SavedMeal[]> {
  const rows = await db
    .select({
      id: meals.id,
      title: meals.title,
      notes: meals.notes,
      defaultMealType: meals.defaultMealType,
    })
    .from(meals)
    .where(eq(meals.householdId, ctx.householdId))
    .orderBy(asc(meals.title));

  if (!rows.length) return [];

  const componentRows = await db
    .select({
      id: mealComponents.id,
      mealId: mealComponents.mealId,
      role: mealComponents.role,
      position: mealComponents.position,
      recipe: {
        id: recipes.id,
        title: recipes.title,
        thumbnailUrl: recipes.thumbnailUrl,
        imageUrl: recipes.imageUrl,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
      },
    })
    .from(mealComponents)
    .innerJoin(recipes, eq(mealComponents.recipeId, recipes.id))
    .where(
      and(
        inArray(
          mealComponents.mealId,
          rows.map((r) => r.id)
        ),
        eq(recipes.householdId, ctx.householdId)
      )
    );

  const byMeal = new Map<string, SavedMealComponent[]>();
  for (const { mealId, role, ...c } of componentRows) {
    const list = byMeal.get(mealId) ?? [];
    list.push({ ...c, role: isMealRole(role) ? role : "side" });
    byMeal.set(mealId, list);
  }

  return rows.map((m) => ({
    ...m,
    components: (byMeal.get(m.id) ?? []).sort(byRoleThenPosition),
  }));
}

export async function getMeal(ctx: HouseholdContext, mealId: string): Promise<SavedMeal> {
  await assertMealOwned(ctx, mealId);
  const meal = (await listMeals(ctx)).find((m) => m.id === mealId);
  if (!meal) throw new MealNotFoundError();
  return meal;
}

// --- Writes -----------------------------------------------------------------

export async function createMeal(ctx: HouseholdContext, input: SaveMealInput): Promise<string> {
  const title = cleanTitle(input.title);
  const mealType = input.defaultMealType ?? "dinner";
  assertMealType(mealType);
  await validateComponents(ctx, input.components);

  return runInTransaction(async () => {
    const [meal] = await db
      .insert(meals)
      .values({
        householdId: ctx.householdId,
        createdById: ctx.memberId,
        title,
        notes: input.notes?.trim() || null,
        defaultMealType: mealType,
      })
      .returning({ id: meals.id });
    await replaceComponents(meal!.id, input.components);
    return meal!.id;
  });
}

export async function updateMeal(
  ctx: HouseholdContext,
  mealId: string,
  input: SaveMealInput
): Promise<void> {
  const title = cleanTitle(input.title);
  const mealType = input.defaultMealType ?? "dinner";
  assertMealType(mealType);
  await assertMealOwned(ctx, mealId);
  await validateComponents(ctx, input.components);

  await runInTransaction(async () => {
    await db
      .update(meals)
      .set({ title, notes: input.notes?.trim() || null, defaultMealType: mealType })
      .where(eq(meals.id, mealId));
    await replaceComponents(mealId, input.components);
  });
}

export async function deleteMeal(ctx: HouseholdContext, mealId: string): Promise<void> {
  await assertMealOwned(ctx, mealId);
  // Planned copies keep their recipes; their source link is cleared by the FK.
  await db.delete(meals).where(eq(meals.id, mealId));
}

/**
 * Save a planned meal's current recipes as a new saved meal, and link the
 * planned meal to it so "update saved meal" knows where to write later.
 */
export async function saveGroupAsMeal(
  ctx: HouseholdContext,
  groupId: string,
  title?: string
): Promise<string> {
  const { group, components } = await getGroupComponents(ctx, groupId);
  return runInTransaction(async () => {
    const mealId = await createMeal(ctx, {
      title: title ?? group.title,
      defaultMealType: group.mealType,
      components,
    });
    await setGroupSourceMeal(ctx, groupId, mealId);
    return mealId;
  });
}

/** Overwrite the linked saved meal with the planned meal's current recipes. */
export async function updateMealFromGroup(ctx: HouseholdContext, groupId: string): Promise<void> {
  const { group, components } = await getGroupComponents(ctx, groupId);
  if (!group.sourceMealId) throw new MealValidationError("This meal isn't linked to a saved meal");

  const existing = await getMeal(ctx, group.sourceMealId);
  await updateMeal(ctx, existing.id, {
    title: existing.title,
    notes: existing.notes,
    defaultMealType: existing.defaultMealType,
    components,
  });
}
