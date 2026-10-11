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
import { runInTransaction } from "@dishes/db";
import {
  mealPlans,
  mealPlanEntries,
  mealPlanGroups,
  meals,
  recipes,
  recipeIngredients,
  shoppingListItems,
  shoppingListItemRecipes,
  householdMembers,
} from "@dishes/db/schema";
import { eq, and, asc, inArray, isNull, sql } from "drizzle-orm";
import { MEAL_ROLES, MEAL_TYPES, isMealRole, type MealRole, type MealType } from "@dishes/shared";
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

export class MealPlanGroupNotFoundError extends Error {
  constructor() {
    super("Meal not found");
    this.name = "MealPlanGroupNotFoundError";
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

/** `YYYY-MM-DD` naming a Monday — the only dates a plan's week can start on. */
export function assertWeekStart(weekStartDate: string): void {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)
    ? new Date(weekStartDate + "T00:00:00Z")
    : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== weekStartDate) {
    throw new MealPlanValidationError("weekStartDate must be a valid YYYY-MM-DD date");
  }
  if (d.getUTCDay() !== 1) {
    throw new MealPlanValidationError("weekStartDate must be a Monday");
  }
}

export function assertMealType(mealType: string): asserts mealType is MealType {
  if (!(MEAL_TYPES as readonly string[]).includes(mealType)) {
    throw new MealPlanValidationError("Invalid meal type");
  }
}

export function assertMealRole(role: string): asserts role is MealRole {
  if (!isMealRole(role)) {
    throw new MealPlanValidationError("Invalid meal role");
  }
}

function assertServings(servings: number | null | undefined): void {
  if (servings !== undefined && servings !== null && (servings <= 0 || !isFinite(servings))) {
    throw new MealPlanValidationError("servings must be a positive number or null");
  }
}

function assertGroupTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new MealPlanValidationError("A meal needs a name");
  if (trimmed.length > 200) throw new MealPlanValidationError("Meal name is too long");
  return trimmed;
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
    .select({
      id: mealPlanEntries.id,
      mealPlanId: mealPlanEntries.mealPlanId,
      groupId: mealPlanEntries.groupId,
      dayOfWeek: mealPlanEntries.dayOfWeek,
      mealType: mealPlanEntries.mealType,
    })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .where(
      and(eq(mealPlanEntries.id, entryId), eq(mealPlans.householdId, householdId))
    )
    .limit(1);

  if (!entry) throw new MealPlanEntryNotFoundError();
  return entry;
}

/** A planned meal group, verified through its plan's household. */
async function assertGroupOwned(groupId: string, householdId: string) {
  const [group] = await db
    .select({
      id: mealPlanGroups.id,
      mealPlanId: mealPlanGroups.mealPlanId,
      title: mealPlanGroups.title,
      dayOfWeek: mealPlanGroups.dayOfWeek,
      mealType: mealPlanGroups.mealType,
      sourceMealId: mealPlanGroups.sourceMealId,
    })
    .from(mealPlanGroups)
    .innerJoin(mealPlans, eq(mealPlanGroups.mealPlanId, mealPlans.id))
    .where(and(eq(mealPlanGroups.id, groupId), eq(mealPlans.householdId, householdId)))
    .limit(1);

  if (!group) throw new MealPlanGroupNotFoundError();
  return group;
}

/**
 * A group with no recipes left is meaningless — drop it. Called after anything
 * that takes an entry out of a group (removal, detach, moving it elsewhere).
 */
async function deleteGroupIfEmpty(groupId: string | null): Promise<void> {
  if (!groupId) return;
  const [remaining] = await db
    .select({ id: mealPlanEntries.id })
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.groupId, groupId))
    .limit(1);
  if (!remaining) {
    await db.delete(mealPlanGroups).where(eq(mealPlanGroups.id, groupId));
  }
}

/** Every recipe id given must belong to this household. */
async function assertRecipesOwned(householdId: string, recipeIds: string[]): Promise<void> {
  const unique = [...new Set(recipeIds)];
  if (!unique.length) return;
  const rows = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.householdId, householdId), inArray(recipes.id, unique)));
  if (rows.length !== unique.length) {
    throw new MealPlanValidationError("Recipe not found");
  }
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

  if (!plan) return { plan: null, entries: [], groups: [] };

  const groups = await db
    .select({
      id: mealPlanGroups.id,
      title: mealPlanGroups.title,
      dayOfWeek: mealPlanGroups.dayOfWeek,
      mealType: mealPlanGroups.mealType,
      sourceMealId: mealPlanGroups.sourceMealId,
    })
    .from(mealPlanGroups)
    .where(eq(mealPlanGroups.mealPlanId, plan.id))
    .orderBy(asc(mealPlanGroups.dayOfWeek), asc(mealPlanGroups.createdAt));

  const entries = await db
    .select({
      id: mealPlanEntries.id,
      dayOfWeek: mealPlanEntries.dayOfWeek,
      mealType: mealPlanEntries.mealType,
      servings: mealPlanEntries.servings,
      notes: mealPlanEntries.notes,
      addedToShoppingListAt: mealPlanEntries.addedToShoppingListAt,
      groupId: mealPlanEntries.groupId,
      mealRole: mealPlanEntries.mealRole,
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

  return { plan, entries, groups };
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

export type AddEntryOptions = {
  /** Add the recipe to this planned meal; its slot wins over dayOfWeek/mealType. */
  groupId?: string | null;
  mealRole?: MealRole | null;
};

export async function addEntry(
  ctx: HouseholdContext,
  weekStartDate: string,
  recipeId: string,
  dayOfWeek: number,
  mealType: MealType,
  servings?: number | null,
  opts: AddEntryOptions = {}
): Promise<string> {
  assertDayOfWeek(dayOfWeek);
  assertMealType(mealType);
  assertServings(servings);
  if (opts.mealRole) assertMealRole(opts.mealRole);

  await assertRecipesOwned(ctx.householdId, [recipeId]);

  const plan = await getOrCreatePlan(ctx, weekStartDate);

  // A group's recipes always share its slot, whatever the caller passed.
  let slot = { dayOfWeek, mealType };
  if (opts.groupId) {
    const group = await assertGroupOwned(opts.groupId, ctx.householdId);
    if (group.mealPlanId !== plan.id) {
      throw new MealPlanValidationError("That meal is in a different week");
    }
    slot = { dayOfWeek: group.dayOfWeek, mealType: group.mealType };
  }

  const [entry] = await db
    .insert(mealPlanEntries)
    .values({
      mealPlanId: plan.id,
      recipeId,
      dayOfWeek: slot.dayOfWeek,
      mealType: slot.mealType,
      servings: servings != null ? String(servings) : null,
      groupId: opts.groupId ?? null,
      mealRole: opts.groupId ? (opts.mealRole ?? "side") : null,
    })
    .returning({ id: mealPlanEntries.id });

  return entry!.id;
}

/**
 * Move an entry to another day. With `weekStartDate` it can land in a different
 * week too (Sunday → next Monday): the entry is re-parented onto that week's
 * plan, which is created if the week has never been planned.
 *
 * Moving one recipe of a combined meal to another day or week takes it out of
 * the meal — the group's slot is the meal's, and a recipe somewhere else is no
 * longer part of it. Moving the whole meal is `updateGroup`.
 */
export async function moveEntry(
  ctx: HouseholdContext,
  entryId: string,
  newDayOfWeek: number,
  weekStartDate?: string
): Promise<void> {
  assertDayOfWeek(newDayOfWeek);
  if (weekStartDate !== undefined) assertWeekStart(weekStartDate);
  const entry = await assertEntryOwned(entryId, ctx.householdId);

  await runInTransaction(async () => {
    const mealPlanId =
      weekStartDate !== undefined ? (await getOrCreatePlan(ctx, weekStartDate)).id : undefined;
    const changesPlan = mealPlanId !== undefined && mealPlanId !== entry.mealPlanId;
    const leavesGroup =
      entry.groupId !== null && (entry.dayOfWeek !== newDayOfWeek || changesPlan);

    await db
      .update(mealPlanEntries)
      .set({
        dayOfWeek: newDayOfWeek,
        ...(mealPlanId ? { mealPlanId } : {}),
        ...(leavesGroup ? { groupId: null, mealRole: null } : {}),
      })
      .where(eq(mealPlanEntries.id, entryId));
    if (leavesGroup) await deleteGroupIfEmpty(entry.groupId);
  });
}

export async function changeEntryType(
  ctx: HouseholdContext,
  entryId: string,
  newMealType: string
): Promise<void> {
  assertMealType(newMealType);
  const entry = await assertEntryOwned(entryId, ctx.householdId);
  const leavesGroup = entry.groupId !== null && entry.mealType !== newMealType;

  await runInTransaction(async () => {
    await db
      .update(mealPlanEntries)
      .set(
        leavesGroup
          ? { mealType: newMealType, groupId: null, mealRole: null }
          : { mealType: newMealType }
      )
      .where(eq(mealPlanEntries.id, entryId));
    if (leavesGroup) await deleteGroupIfEmpty(entry.groupId);
  });
}

export async function removeEntry(
  ctx: HouseholdContext,
  entryId: string
): Promise<void> {
  const entry = await assertEntryOwned(entryId, ctx.householdId);

  await runInTransaction(async () => {
    await db.delete(mealPlanEntries).where(eq(mealPlanEntries.id, entryId));
    await deleteGroupIfEmpty(entry.groupId);
  });
}

export async function updateEntryServings(
  ctx: HouseholdContext,
  entryId: string,
  servings: number | null
): Promise<void> {
  assertServings(servings);

  await assertEntryOwned(entryId, ctx.householdId);

  await db
    .update(mealPlanEntries)
    .set({ servings: servings !== null ? String(servings) : null })
    .where(eq(mealPlanEntries.id, entryId));
}

/**
 * Swap the recipe on an entry in place — same slot, same meal and role, same
 * headcount. The new recipe has not been shopped for, so the flag is cleared.
 */
export async function replaceEntryRecipe(
  ctx: HouseholdContext,
  entryId: string,
  recipeId: string
): Promise<void> {
  await assertEntryOwned(entryId, ctx.householdId);
  await assertRecipesOwned(ctx.householdId, [recipeId]);

  await db
    .update(mealPlanEntries)
    .set({ recipeId, addedToShoppingListAt: null })
    .where(eq(mealPlanEntries.id, entryId));
}

/**
 * Put an entry into a planned meal (taking that meal's slot), change its role
 * within one, or take it out (`groupId: null`).
 */
export async function setEntryGroup(
  ctx: HouseholdContext,
  entryId: string,
  groupId: string | null,
  mealRole?: MealRole | null
): Promise<void> {
  if (mealRole) assertMealRole(mealRole);
  const entry = await assertEntryOwned(entryId, ctx.householdId);

  await runInTransaction(async () => {
    if (groupId === null) {
      await db
        .update(mealPlanEntries)
        .set({ groupId: null, mealRole: null })
        .where(eq(mealPlanEntries.id, entryId));
      await deleteGroupIfEmpty(entry.groupId);
      return;
    }

    const group = await assertGroupOwned(groupId, ctx.householdId);
    if (group.mealPlanId !== entry.mealPlanId) {
      throw new MealPlanValidationError("That meal is in a different week");
    }

    await db
      .update(mealPlanEntries)
      .set({
        groupId,
        mealRole: mealRole ?? (entry.groupId === groupId ? undefined : "side"),
        dayOfWeek: group.dayOfWeek,
        mealType: group.mealType,
      })
      .where(eq(mealPlanEntries.id, entryId));

    if (entry.groupId !== groupId) await deleteGroupIfEmpty(entry.groupId);
  });
}

// --- Planned meal groups ----------------------------------------------------

export type GroupComponentInput = { recipeId: string; role: MealRole };

export type AddGroupInput = {
  weekStartDate: string;
  title: string;
  dayOfWeek: number;
  mealType: MealType;
  /** The saved meal this came from, if any. Must belong to the household. */
  sourceMealId?: string | null;
  /** Applied to every new entry; null = each recipe's own base servings. */
  servings?: number | null;
  /** New recipes to add as part of the meal. */
  components?: GroupComponentInput[];
  /** Entries already on the plan to pull into the meal (same week). */
  entries?: { entryId: string; role: MealRole }[];
};

/**
 * Create a combined meal on the plan: the group row, any new entries for its
 * components, and any existing entries pulled in — atomically, so a failure
 * never leaves half a meal behind.
 */
export async function addGroup(ctx: HouseholdContext, input: AddGroupInput): Promise<string> {
  assertDayOfWeek(input.dayOfWeek);
  assertMealType(input.mealType);
  assertServings(input.servings);
  const title = assertGroupTitle(input.title);

  const components = input.components ?? [];
  const pulledIn = new Map((input.entries ?? []).map((e) => [e.entryId, e.role]));
  const entryIds = [...pulledIn.keys()];
  for (const c of components) assertMealRole(c.role);
  for (const role of pulledIn.values()) assertMealRole(role);
  if (!components.length && !entryIds.length) {
    throw new MealPlanValidationError("A meal needs at least one recipe");
  }

  await assertRecipesOwned(ctx.householdId, components.map((c) => c.recipeId));

  if (input.sourceMealId) {
    const [meal] = await db
      .select({ id: meals.id })
      .from(meals)
      .where(and(eq(meals.id, input.sourceMealId), eq(meals.householdId, ctx.householdId)))
      .limit(1);
    if (!meal) throw new MealPlanValidationError("Saved meal not found");
  }

  return runInTransaction(async () => {
    const plan = await getOrCreatePlan(ctx, input.weekStartDate);

    const existing = entryIds.length
      ? await db
          .select({ id: mealPlanEntries.id, groupId: mealPlanEntries.groupId })
          .from(mealPlanEntries)
          .where(
            and(
              eq(mealPlanEntries.mealPlanId, plan.id),
              inArray(mealPlanEntries.id, entryIds)
            )
          )
      : [];
    if (existing.length !== entryIds.length) {
      throw new MealPlanValidationError("Meal plan entry not found");
    }

    const [group] = await db
      .insert(mealPlanGroups)
      .values({
        mealPlanId: plan.id,
        title,
        dayOfWeek: input.dayOfWeek,
        mealType: input.mealType,
        sourceMealId: input.sourceMealId ?? null,
      })
      .returning({ id: mealPlanGroups.id });

    if (components.length) {
      await db.insert(mealPlanEntries).values(
        components.map((c) => ({
          mealPlanId: plan.id,
          recipeId: c.recipeId,
          dayOfWeek: input.dayOfWeek,
          mealType: input.mealType,
          servings: input.servings != null ? String(input.servings) : null,
          groupId: group!.id,
          mealRole: c.role,
        }))
      );
    }

    if (existing.length) {
      for (const [entryId, role] of pulledIn) {
        await db
          .update(mealPlanEntries)
          .set({
            groupId: group!.id,
            mealRole: role,
            dayOfWeek: input.dayOfWeek,
            mealType: input.mealType,
          })
          .where(eq(mealPlanEntries.id, entryId));
      }
      for (const oldGroupId of new Set(existing.map((e) => e.groupId))) {
        await deleteGroupIfEmpty(oldGroupId);
      }
    }

    return group!.id;
  });
}

export type UpdateGroupInput = {
  title?: string;
  dayOfWeek?: number;
  mealType?: MealType;
  /** Set on every recipe in the meal. */
  servings?: number | null;
};

/** Rename, move, re-slot or re-serve a whole meal; its entries follow. */
export async function updateGroup(
  ctx: HouseholdContext,
  groupId: string,
  input: UpdateGroupInput
): Promise<void> {
  if (input.dayOfWeek !== undefined) assertDayOfWeek(input.dayOfWeek);
  if (input.mealType !== undefined) assertMealType(input.mealType);
  assertServings(input.servings);
  const title = input.title !== undefined ? assertGroupTitle(input.title) : undefined;

  await assertGroupOwned(groupId, ctx.householdId);

  await runInTransaction(async () => {
    const groupSet = {
      ...(title !== undefined && { title }),
      ...(input.dayOfWeek !== undefined && { dayOfWeek: input.dayOfWeek }),
      ...(input.mealType !== undefined && { mealType: input.mealType }),
    };
    if (Object.keys(groupSet).length) {
      await db.update(mealPlanGroups).set(groupSet).where(eq(mealPlanGroups.id, groupId));
    }

    const entrySet = {
      ...(input.dayOfWeek !== undefined && { dayOfWeek: input.dayOfWeek }),
      ...(input.mealType !== undefined && { mealType: input.mealType }),
      ...(input.servings !== undefined && {
        servings: input.servings !== null ? String(input.servings) : null,
      }),
    };
    if (Object.keys(entrySet).length) {
      await db.update(mealPlanEntries).set(entrySet).where(eq(mealPlanEntries.groupId, groupId));
    }
  });
}

/**
 * Remove a meal from the plan. `keepRecipes` ungroups instead — the recipes
 * stay on the plan as separate meals and only the grouping goes.
 */
export async function removeGroup(
  ctx: HouseholdContext,
  groupId: string,
  opts: { keepRecipes?: boolean } = {}
): Promise<void> {
  await assertGroupOwned(groupId, ctx.householdId);

  await runInTransaction(async () => {
    if (opts.keepRecipes) {
      await db
        .update(mealPlanEntries)
        .set({ groupId: null, mealRole: null })
        .where(eq(mealPlanEntries.groupId, groupId));
    }
    // Entries still pointing here cascade with it.
    await db.delete(mealPlanGroups).where(eq(mealPlanGroups.id, groupId));
  });
}

/** Link (or unlink) a planned meal to the saved meal it is a copy of. */
export async function setGroupSourceMeal(
  ctx: HouseholdContext,
  groupId: string,
  sourceMealId: string | null
): Promise<void> {
  await assertGroupOwned(groupId, ctx.householdId);
  await db
    .update(mealPlanGroups)
    .set({ sourceMealId })
    .where(eq(mealPlanGroups.id, groupId));
}

/** The recipes in a planned meal, for saving it as a reusable meal. */
export async function getGroupComponents(
  ctx: HouseholdContext,
  groupId: string
): Promise<{ group: Awaited<ReturnType<typeof assertGroupOwned>>; components: GroupComponentInput[] }> {
  const group = await assertGroupOwned(groupId, ctx.householdId);
  const rows = await db
    .select({ recipeId: mealPlanEntries.recipeId, role: mealPlanEntries.mealRole })
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.groupId, groupId))
    .orderBy(asc(mealPlanEntries.id));
  // Saved in display order — main first — so a saved meal reads the same way.
  const components = rows
    .map((r) => ({ recipeId: r.recipeId, role: isMealRole(r.role) ? r.role : ("side" as const) }))
    .sort((a, b) => MEAL_ROLES.indexOf(a.role) - MEAL_ROLES.indexOf(b.role));
  return { group, components };
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

    const sourceRows = ing.recipeIds.map((recipeId) => ({ recipeId }));

    // Prefer a row still to be bought, but fall back to one already ticked off.
    // Excluding ticked rows from matching is what put a whole completed shop
    // back on the list: tick off the week's ingredients, add one more meal, and
    // every ingredient it shares with that shop returns as a fresh unbought
    // line. Something in the basket already satisfies the need.
    const sameLine = existingItems.filter(
      (e) =>
        e.ingredientName.toLowerCase().trim() === normalName && e.unit === ing.unit
    );
    const openMatch = sameLine.find((e) => !e.isChecked);
    const match = openMatch ?? sameLine[0];

    if (match) {
      // Only a row still to be bought gets topped up, and only when both sides
      // are numeric — a ticked row is in the basket, so raising its quantity
      // would be a number nobody acts on. Either way it is already on the list,
      // which is the part that matters; record the extra source and move on.
      if (openMatch && match.amount !== null && scaledAmountStr !== null) {
        const newAmount = (
          Math.round(
            (parseFloat(match.amount) + parseFloat(scaledAmountStr)) * 1000
          ) / 1000
        ).toString();
        await db
          .update(shoppingListItems)
          .set({ amount: newAmount })
          .where(eq(shoppingListItems.id, match.id));
        match.amount = newAmount;
      }
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
      // Visible to the rest of this batch, so a recipe naming the same
      // ingredient twice merges instead of adding it twice.
      existingItems.push({
        id: inserted!.id,
        ingredientName: ing.ingredientName,
        amount: scaledAmountStr,
        unit: ing.unit,
        position: posCounter - 1,
        isChecked: false,
      });
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

/**
 * Scaled ingredient totals across a set of planned entries, keyed on name +
 * unit so "200g flour" from two recipes becomes one 400g line.
 */
async function aggregateIngredients(
  ctx: HouseholdContext,
  entries: { recipeId: string; servings: string | null }[]
): Promise<PendingIngredient[]> {
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

  return [...totals.values()];
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

  const totals = await aggregateIngredients(ctx, entries);

  const exclusions = await getPantryExclusions(ctx.householdId);
  const { result } = await applyToShoppingList(
    ctx,
    totals,
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

/**
 * Every recipe in one planned meal onto the shopping list, consolidated the
 * same way a whole week is. Re-adding is deliberate here (the menu says "again"),
 * so unlike the week it does not skip entries already flagged.
 */
export async function addGroupToShoppingList(
  ctx: ActorContext,
  groupId: string,
  opts?: { forceInclude?: string[] }
): Promise<ShoppingAddResult> {
  const empty: ShoppingAddResult = { added: 0, merged: 0, skipped: [] };

  await assertGroupOwned(groupId, ctx.householdId);

  const entries = await db
    .select({ recipeId: mealPlanEntries.recipeId, servings: mealPlanEntries.servings })
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.groupId, groupId));

  if (!entries.length) return empty;

  const pending = await aggregateIngredients(ctx, entries);
  const exclusions = await getPantryExclusions(ctx.householdId);
  const { result } = await applyToShoppingList(
    ctx,
    pending,
    exclusions,
    toForceIncludeSet(opts?.forceInclude)
  );

  if (result.added + result.merged > 0) {
    await db
      .update(mealPlanEntries)
      .set({ addedToShoppingListAt: new Date() })
      .where(eq(mealPlanEntries.groupId, groupId));
  }

  return result;
}
