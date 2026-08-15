/**
 * Recipe domain logic — the single implementation shared by server actions
 * (`app/actions/recipes.ts`) and REST route handlers (`app/api/v1/recipes`).
 *
 * Rules for this layer, and for every service module that follows it:
 *   - Takes a HouseholdContext; never reads headers or cookies itself.
 *   - Takes plain typed objects; never FormData.
 *   - Returns data or throws; never redirects, never calls revalidatePath.
 *     Cache invalidation and navigation belong to the caller, because they
 *     are meaningless to a native client.
 *   - Every query is scoped by householdId. Not optional.
 */

import { db } from "@/lib/db";
import {
  recipes,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  collections,
  recipeCollections,
} from "@dishes/db/schema";
import { eq, and, inArray, or, ilike, isNotNull, sql, desc, asc } from "drizzle-orm";
import { MEAL_TYPES } from "@dishes/shared";
import type { HouseholdContext } from "@/lib/session";

// --- Errors -----------------------------------------------------------------

/** Recipe absent, or owned by another household — indistinguishable on purpose. */
export class RecipeNotFoundError extends Error {
  constructor() {
    super("Recipe not found");
    this.name = "RecipeNotFoundError";
  }
}

export class RecipeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeValidationError";
  }
}

// --- Input types ------------------------------------------------------------

export type IngredientInput = {
  ingredientName: string;
  amount: string;
  unit: string;
  preparation: string;
  isOptional: boolean;
  groupLabel: string;
};

export type StepInput = {
  instruction: string;
  durationMinutes: string;
  timerLabel: string;
  groupLabel: string;
};

export type NutritionInput = {
  calories: number | null;
  proteinG: string | null;
  carbsG: string | null;
  fatG: string | null;
  fiberG: string | null;
  sugarG: string | null;
  sodiumMg: string | null;
  nutritionSource: "manual" | "ai" | "none";
};

export type RecipeFields = {
  title: string;
  description: string | null;
  cuisine: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: string | null;
  servingsUnit: string;
  difficulty: "easy" | "medium" | "hard" | null;
  mealTypes: string[] | null;
  sourceUrl: string | null;
  notes: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
} & NutritionInput;

export type RecipeWriteInput = {
  fields: RecipeFields;
  ingredients: IngredientInput[];
  steps: StepInput[];
  tags: string[];
  /** Optional collection to file the recipe into; ignored if not this household's. */
  collectionId?: string | null;
  isAiGenerated?: boolean;
};

export type RecipeListFilters = {
  q?: string;
  cuisine?: string;
  favouritesOnly?: boolean;
  difficulty?: string;
  maxTotalMinutes?: number;
  tags?: string[];
  sort?: "recent" | "title" | "time";
  limit?: number;
  offset?: number;
};

// --- Helpers ----------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep only valid, de-duplicated meal types. null = "unknown / fits any slot". */
export function sanitizeMealTypes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const valid = [...new Set(raw)].filter(
    (v): v is string =>
      typeof v === "string" && (MEAL_TYPES as readonly string[]).includes(v)
  );
  return valid.length ? valid : null;
}

export const EMPTY_NUTRITION: NutritionInput = {
  calories: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
  fiberG: null,
  sugarG: null,
  sodiumMg: null,
  nutritionSource: "none",
};

/**
 * Build a nutrition block from raw numbers, tagging the source only when at
 * least one value survived. Shared by the manual form path and the AI path.
 */
export function buildNutrition(
  values: {
    calories?: number | string | null;
    proteinG?: number | string | null;
    carbsG?: number | string | null;
    fatG?: number | string | null;
    fiberG?: number | string | null;
    sugarG?: number | string | null;
    sodiumMg?: number | string | null;
  } | null | undefined,
  source: "manual" | "ai"
): NutritionInput {
  const decimal = (v: number | string | null | undefined): string | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
  };
  const caloriesRaw = decimal(values?.calories);

  const fields = {
    calories: caloriesRaw === null ? null : Math.round(Number(caloriesRaw)),
    proteinG: decimal(values?.proteinG),
    carbsG: decimal(values?.carbsG),
    fatG: decimal(values?.fatG),
    fiberG: decimal(values?.fiberG),
    sugarG: decimal(values?.sugarG),
    sodiumMg: decimal(values?.sodiumMg),
  };

  const hasAny = Object.values(fields).some((v) => v != null);
  return { ...fields, nutritionSource: hasAny ? source : "none" };
}

/** Throws unless the recipe exists and belongs to this household. */
async function assertOwned(recipeId: string, householdId: string): Promise<void> {
  const [row] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!row) throw new RecipeNotFoundError();
}

async function insertIngredients(recipeId: string, ingredients: IngredientInput[]) {
  if (!ingredients.length) return;
  await db.insert(recipeIngredients).values(
    ingredients.map((ing, i) => ({
      recipeId,
      position: i,
      ingredientName: ing.ingredientName,
      amount: ing.amount || null,
      unit: ing.unit || null,
      preparation: ing.preparation || null,
      isOptional: ing.isOptional,
      groupLabel: ing.groupLabel || null,
    }))
  );
}

async function insertSteps(recipeId: string, steps: StepInput[]) {
  if (!steps.length) return;
  await db.insert(recipeSteps).values(
    steps.map((step, i) => ({
      recipeId,
      position: i,
      instruction: step.instruction,
      durationMinutes: step.durationMinutes ? parseInt(step.durationMinutes) : null,
      timerLabel: step.timerLabel || null,
      groupLabel: step.groupLabel || null,
    }))
  );
}

async function insertTags(recipeId: string, tags: string[]) {
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  if (!clean.length) return;
  await db.insert(recipeTags).values(clean.map((tag) => ({ recipeId, tag })));
}

/**
 * Link a recipe to one of this household's collections. Silently ignores
 * anything that isn't a valid, owned collection id.
 *
 * Returns the collection id when a link was made, so the caller knows which
 * paths to revalidate.
 */
async function linkCollection(
  recipeId: string,
  householdId: string,
  collectionId: string | null | undefined
): Promise<string | null> {
  const id = collectionId?.trim();
  if (!id || !UUID_RE.test(id)) return null;

  const [owned] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.householdId, householdId)))
    .limit(1);
  if (!owned) return null;

  await db
    .insert(recipeCollections)
    .values({ collectionId: id, recipeId })
    .onConflictDoNothing();

  return id;
}

/** Replace the full child-row set for a recipe (ingredients, steps, tags). */
async function replaceChildren(
  recipeId: string,
  input: Pick<RecipeWriteInput, "ingredients" | "steps" | "tags">
) {
  await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
  await db.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipeId));
  await db.delete(recipeTags).where(eq(recipeTags.recipeId, recipeId));

  await Promise.all([
    insertIngredients(recipeId, input.ingredients),
    insertSteps(recipeId, input.steps),
    insertTags(recipeId, input.tags),
  ]);
}

// --- Reads ------------------------------------------------------------------

export async function listRecipes(
  ctx: HouseholdContext,
  filters: RecipeListFilters = {}
) {
  const conditions = [eq(recipes.householdId, ctx.householdId)];

  const q = filters.q?.trim();
  if (q) {
    conditions.push(
      or(
        ilike(recipes.title, `%${q}%`),
        inArray(
          recipes.id,
          db
            .select({ id: recipeTags.recipeId })
            .from(recipeTags)
            .where(ilike(recipeTags.tag, `%${q}%`))
        )
      )!
    );
  }

  const cuisine = filters.cuisine?.trim();
  if (cuisine) conditions.push(eq(recipes.cuisine, cuisine));

  if (filters.favouritesOnly) conditions.push(eq(recipes.isFavourite, true));

  const difficulty = filters.difficulty?.trim();
  if (difficulty && ["easy", "medium", "hard"].includes(difficulty)) {
    conditions.push(eq(recipes.difficulty, difficulty as "easy" | "medium" | "hard"));
  }

  if (filters.maxTotalMinutes != null && Number.isFinite(filters.maxTotalMinutes)) {
    conditions.push(
      and(
        or(isNotNull(recipes.prepTimeMinutes), isNotNull(recipes.cookTimeMinutes))!,
        sql`COALESCE(${recipes.prepTimeMinutes}, 0) + COALESCE(${recipes.cookTimeMinutes}, 0) <= ${filters.maxTotalMinutes}`
      )!
    );
  }

  const tagList = filters.tags?.filter(Boolean) ?? [];
  if (tagList.length) {
    conditions.push(
      inArray(
        recipes.id,
        db
          .select({ id: recipeTags.recipeId })
          .from(recipeTags)
          .where(inArray(recipeTags.tag, tagList))
      )
    );
  }

  const orderBy =
    filters.sort === "title"
      ? asc(recipes.title)
      : filters.sort === "time"
        ? asc(sql`COALESCE(${recipes.prepTimeMinutes}, 0) + COALESCE(${recipes.cookTimeMinutes}, 0)`)
        : desc(recipes.updatedAt);

  return db
    .select()
    .from(recipes)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(Math.min(filters.limit ?? 100, 500))
    .offset(filters.offset ?? 0);
}

/** Full recipe with ingredients, steps and tags. Throws if not owned. */
export async function getRecipe(ctx: HouseholdContext, recipeId: string) {
  const [recipe] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, ctx.householdId)))
    .limit(1);

  if (!recipe) throw new RecipeNotFoundError();

  const [ingredients, steps, tags] = await Promise.all([
    db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeId))
      .orderBy(asc(recipeIngredients.position)),
    db
      .select()
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipeId))
      .orderBy(asc(recipeSteps.position)),
    db.select().from(recipeTags).where(eq(recipeTags.recipeId, recipeId)),
  ]);

  return { ...recipe, ingredients, steps, tags: tags.map((t) => t.tag) };
}

// --- Writes -----------------------------------------------------------------

export type CreateRecipeResult = { recipeId: string; linkedCollectionId: string | null };

export async function createRecipe(
  ctx: HouseholdContext,
  input: RecipeWriteInput
): Promise<CreateRecipeResult> {
  if (!input.fields.title?.trim()) {
    throw new RecipeValidationError("Title is required");
  }

  const [recipe] = await db
    .insert(recipes)
    .values({
      householdId: ctx.householdId,
      createdById: ctx.memberId,
      isAiGenerated: input.isAiGenerated ?? false,
      ...input.fields,
    })
    .returning({ id: recipes.id });

  const recipeId = recipe!.id;

  const [, , , linkedCollectionId] = await Promise.all([
    insertIngredients(recipeId, input.ingredients),
    insertSteps(recipeId, input.steps),
    insertTags(recipeId, input.tags),
    linkCollection(recipeId, ctx.householdId, input.collectionId),
  ]);

  return { recipeId, linkedCollectionId };
}

export async function updateRecipe(
  ctx: HouseholdContext,
  recipeId: string,
  input: RecipeWriteInput
): Promise<void> {
  if (!input.fields.title?.trim()) {
    throw new RecipeValidationError("Title is required");
  }

  await assertOwned(recipeId, ctx.householdId);

  await db
    .update(recipes)
    .set(input.fields)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, ctx.householdId)));

  await replaceChildren(recipeId, input);
}

export async function deleteRecipe(
  ctx: HouseholdContext,
  recipeId: string
): Promise<void> {
  const deleted = await db
    .delete(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, ctx.householdId)))
    .returning({ id: recipes.id });

  if (!deleted.length) throw new RecipeNotFoundError();
}

/** Returns the new state so callers can report it without re-reading. */
export async function toggleFavourite(
  ctx: HouseholdContext,
  recipeId: string
): Promise<boolean> {
  const [updated] = await db
    .update(recipes)
    .set({ isFavourite: sql`NOT ${recipes.isFavourite}` })
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, ctx.householdId)))
    .returning({ isFavourite: recipes.isFavourite });

  if (!updated) throw new RecipeNotFoundError();
  return updated.isFavourite;
}

export async function updateRecipeCookTime(
  ctx: HouseholdContext,
  recipeId: string,
  cookTimeMinutes: number
): Promise<void> {
  const [updated] = await db
    .update(recipes)
    .set({ cookTimeMinutes })
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, ctx.householdId)))
    .returning({ id: recipes.id });

  if (!updated) throw new RecipeNotFoundError();
}

export async function bulkAddTags(
  ctx: HouseholdContext,
  recipeIds: string[],
  tags: string[]
): Promise<void> {
  if (!recipeIds.length || !tags.length) return;

  const owned = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.householdId, ctx.householdId), inArray(recipes.id, recipeIds)));
  const ownedIds = owned.map((r) => r.id);
  if (!ownedIds.length) return;

  const existing = await db
    .select({ recipeId: recipeTags.recipeId, tag: recipeTags.tag })
    .from(recipeTags)
    .where(and(inArray(recipeTags.recipeId, ownedIds), inArray(recipeTags.tag, tags)));

  const existingSet = new Set(existing.map((e) => `${e.recipeId}:${e.tag}`));

  const toInsert = ownedIds.flatMap((recipeId) =>
    tags
      .filter((tag) => !existingSet.has(`${recipeId}:${tag}`))
      .map((tag) => ({ recipeId, tag }))
  );

  if (toInsert.length) await db.insert(recipeTags).values(toInsert);
}

export async function bulkRemoveTags(
  ctx: HouseholdContext,
  recipeIds: string[],
  tags: string[]
): Promise<void> {
  if (!recipeIds.length || !tags.length) return;

  const owned = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.householdId, ctx.householdId), inArray(recipes.id, recipeIds)));
  const ownedIds = owned.map((r) => r.id);
  if (!ownedIds.length) return;

  await db
    .delete(recipeTags)
    .where(and(inArray(recipeTags.recipeId, ownedIds), inArray(recipeTags.tag, tags)));
}

/**
 * Overwrite an existing recipe in place with a new body (used by "apply tweak").
 * Distinct from updateRecipe only in that it leaves image/source fields alone.
 */
export async function replaceRecipeBody(
  ctx: HouseholdContext,
  recipeId: string,
  input: Omit<RecipeWriteInput, "collectionId">
): Promise<void> {
  await assertOwned(recipeId, ctx.householdId);

  const { imageUrl, thumbnailUrl, sourceUrl, ...body } = input.fields;

  await db
    .update(recipes)
    .set(body)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, ctx.householdId)));

  await replaceChildren(recipeId, input);
}
