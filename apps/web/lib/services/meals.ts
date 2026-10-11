/**
 * Saved meals — reusable combinations of recipes ("Sunday roast").
 *
 * A saved meal is a set of slots, each a place in the meal (the meat, the veg)
 * holding one or more recipe options. Single-choice slots are filled by one
 * option (chicken | pork | beef); pick-several slots by any number (broccoli,
 * carrots, peas). So one "Sunday roast" covers every meat and veg combination
 * instead of a saved meal per combination.
 *
 * A saved meal is a template. Putting one on the plan copies the chosen
 * options into a planned meal group (`meal-plan.ts#addGroup`), so changing a
 * dish for one week never changes the saved meal. The choices made are
 * remembered as the next time's defaults.
 *
 * Same rules as the other services: takes a context, scopes every query by
 * householdId, never redirects or calls revalidatePath.
 */

import { db } from "@/lib/db";
import { runInTransaction } from "@dishes/db";
import { meals, mealSlots, mealSlotOptions, recipes } from "@dishes/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { MEAL_ROLES, isMealRole, type MealRole, type MealType } from "@dishes/shared";
import type { HouseholdContext } from "@/lib/session";
import {
  assertMealType,
  getGroupComponents,
  rememberSlotChoices,
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

// --- Types ------------------------------------------------------------------

export type SavedMealRecipe = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
};

export type SavedMealOption = {
  id: string;
  position: number;
  isDefault: boolean;
  recipe: SavedMealRecipe;
};

export type SavedMealSlot = {
  id: string;
  role: MealRole;
  label: string | null;
  position: number;
  allowMultiple: boolean;
  options: SavedMealOption[];
};

export type SavedMeal = {
  id: string;
  title: string;
  notes: string | null;
  defaultMealType: MealType;
  slots: SavedMealSlot[];
};

export type MealSlotInput = {
  role: MealRole;
  label?: string | null;
  allowMultiple?: boolean;
  options: { recipeId: string; isDefault?: boolean }[];
};

export type SaveMealInput = {
  title: string;
  notes?: string | null;
  defaultMealType?: MealType;
  slots: MealSlotInput[];
};

// --- Validation -------------------------------------------------------------

function cleanTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new MealValidationError("A meal needs a name");
  if (t.length > 200) throw new MealValidationError("Meal name is too long");
  return t;
}

/**
 * Check the slots and normalise them: labels trimmed, duplicate options
 * within a slot dropped, and a single-choice slot given exactly one default.
 */
async function normaliseSlots(
  ctx: HouseholdContext,
  slots: MealSlotInput[]
): Promise<MealSlotInput[]> {
  if (!slots.length) throw new MealValidationError("A meal needs at least one dish");

  const out = slots.map((slot) => {
    if (!isMealRole(slot.role)) throw new MealValidationError("Invalid meal role");
    const seen = new Set<string>();
    const options = slot.options.filter((o) => !seen.has(o.recipeId) && seen.add(o.recipeId));
    if (!options.length) throw new MealValidationError("Every dish needs at least one recipe");

    const label = slot.label?.trim() || null;
    if (label && label.length > 100) throw new MealValidationError("Dish name is too long");

    const allowMultiple = !!slot.allowMultiple;
    let defaults = options.map((o) => !!o.isDefault);
    if (!allowMultiple) {
      const first = Math.max(0, defaults.indexOf(true));
      defaults = defaults.map((_, i) => i === first);
    }
    return {
      role: slot.role,
      label,
      allowMultiple,
      options: options.map((o, i) => ({ recipeId: o.recipeId, isDefault: defaults[i] })),
    };
  });

  const ids = [...new Set(out.flatMap((s) => s.options.map((o) => o.recipeId)))];
  const owned = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.householdId, ctx.householdId), inArray(recipes.id, ids)));
  if (owned.length !== ids.length) throw new MealValidationError("Recipe not found");

  return out;
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

async function replaceSlots(mealId: string, slots: MealSlotInput[]) {
  await db.delete(mealSlots).where(eq(mealSlots.mealId, mealId));
  for (const [i, slot] of slots.entries()) {
    const [row] = await db
      .insert(mealSlots)
      .values({
        mealId,
        role: slot.role,
        label: slot.label ?? null,
        position: i,
        allowMultiple: !!slot.allowMultiple,
      })
      .returning({ id: mealSlots.id });
    await db.insert(mealSlotOptions).values(
      slot.options.map((o, j) => ({
        slotId: row!.id,
        recipeId: o.recipeId,
        position: j,
        isDefault: !!o.isDefault,
      }))
    );
  }
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

  const slotRows = await db
    .select({
      id: mealSlots.id,
      mealId: mealSlots.mealId,
      role: mealSlots.role,
      label: mealSlots.label,
      position: mealSlots.position,
      allowMultiple: mealSlots.allowMultiple,
    })
    .from(mealSlots)
    .where(inArray(mealSlots.mealId, rows.map((r) => r.id)))
    .orderBy(asc(mealSlots.position));

  const optionRows = slotRows.length
    ? await db
        .select({
          id: mealSlotOptions.id,
          slotId: mealSlotOptions.slotId,
          position: mealSlotOptions.position,
          isDefault: mealSlotOptions.isDefault,
          recipe: {
            id: recipes.id,
            title: recipes.title,
            thumbnailUrl: recipes.thumbnailUrl,
            imageUrl: recipes.imageUrl,
            prepTimeMinutes: recipes.prepTimeMinutes,
            cookTimeMinutes: recipes.cookTimeMinutes,
          },
        })
        .from(mealSlotOptions)
        .innerJoin(recipes, eq(mealSlotOptions.recipeId, recipes.id))
        .where(
          and(
            inArray(mealSlotOptions.slotId, slotRows.map((s) => s.id)),
            eq(recipes.householdId, ctx.householdId)
          )
        )
        .orderBy(asc(mealSlotOptions.position))
    : [];

  const optionsBySlot = new Map<string, SavedMealOption[]>();
  for (const { slotId, ...o } of optionRows) {
    const list = optionsBySlot.get(slotId) ?? [];
    list.push(o);
    optionsBySlot.set(slotId, list);
  }

  const slotsByMeal = new Map<string, SavedMealSlot[]>();
  for (const { mealId, role, ...slot } of slotRows) {
    const options = optionsBySlot.get(slot.id) ?? [];
    // A slot whose recipes were all deleted has nothing to offer.
    if (!options.length) continue;
    const list = slotsByMeal.get(mealId) ?? [];
    list.push({ ...slot, role: isMealRole(role) ? role : "side", options });
    slotsByMeal.set(mealId, list);
  }

  // Main first, then sides, sauces, extras; saved order within a role.
  const byRole = (a: SavedMealSlot, b: SavedMealSlot) =>
    MEAL_ROLES.indexOf(a.role) - MEAL_ROLES.indexOf(b.role) || a.position - b.position;

  return rows.map((m) => ({ ...m, slots: (slotsByMeal.get(m.id) ?? []).sort(byRole) }));
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
  const slots = await normaliseSlots(ctx, input.slots);

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
    await replaceSlots(meal!.id, slots);
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
  const slots = await normaliseSlots(ctx, input.slots);

  await runInTransaction(async () => {
    await db
      .update(meals)
      .set({ title, notes: input.notes?.trim() || null, defaultMealType: mealType })
      .where(eq(meals.id, mealId));
    await replaceSlots(mealId, slots);
  });
}

export async function deleteMeal(ctx: HouseholdContext, mealId: string): Promise<void> {
  await assertMealOwned(ctx, mealId);
  // Planned copies keep their recipes; their source link is cleared by the FK.
  await db.delete(meals).where(eq(meals.id, mealId));
}

/**
 * Save a planned meal's dishes as a new saved meal — one single-option slot
 * per dish — and link the planned meal to it.
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
      slots: components.map((c) => ({
        role: c.role,
        options: [{ recipeId: c.recipeId, isDefault: true }],
      })),
    });
    await setGroupSourceMeal(ctx, groupId, mealId);
    return mealId;
  });
}

/**
 * Fold a planned meal back into the saved meal it came from. Additive, not an
 * overwrite: a dish that is already one of a slot's options becomes that
 * slot's default; a dish the saved meal doesn't offer anywhere is added as a
 * new slot. Nothing is removed — options are pruned on the Saved meals page.
 */
export async function updateMealFromGroup(ctx: HouseholdContext, groupId: string): Promise<void> {
  const { group, components } = await getGroupComponents(ctx, groupId);
  if (!group.sourceMealId) throw new MealValidationError("This meal isn't linked to a saved meal");

  const meal = await getMeal(ctx, group.sourceMealId);
  const offered = new Set(meal.slots.flatMap((s) => s.options.map((o) => o.recipe.id)));
  const extra = components.filter((c) => !offered.has(c.recipeId));

  await runInTransaction(async () => {
    for (const [i, c] of extra.entries()) {
      const [slot] = await db
        .insert(mealSlots)
        .values({
          mealId: meal.id,
          role: c.role,
          position: meal.slots.length + i,
        })
        .returning({ id: mealSlots.id });
      await db
        .insert(mealSlotOptions)
        .values({ slotId: slot!.id, recipeId: c.recipeId, isDefault: true });
    }
    await rememberSlotChoices(
      meal.id,
      components.map((c) => c.recipeId)
    );
  });
}
