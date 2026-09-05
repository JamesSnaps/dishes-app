/**
 * Read-only views of a library someone has shared with this household.
 *
 * Every function starts by resolving the grant through `loadShareScope`, which
 * throws unless the share is live for this grantee, and every query is filtered
 * by `shareScopePredicate`. Nothing here builds its own idea of what is
 * visible.
 *
 * Columns are enumerated by hand rather than `select()`-and-spread, on purpose:
 * the owner's private annotations (`notes`), their favourites, their cook
 * history and who created what are none of the grantee's business, and a
 * wildcard select would quietly start leaking them the next time a column is
 * added to `recipes`.
 */

import { db } from "@/lib/db";
import {
  collections,
  recipeCollections,
  recipeIngredients,
  recipeSteps,
  recipeTags,
  recipes,
} from "@dishes/db/schema";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { HouseholdContext } from "@/lib/session";
import {
  LibraryShareInvalidError,
  loadShareScope,
  shareScopePredicate,
  type ShareScope,
} from "@/lib/services/library-share-scope";

export type SharedRecipeSummary = {
  id: string;
  title: string;
  description: string | null;
  cuisine: string | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  calories: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  isAiGenerated: boolean;
};

/** The columns a shared library may expose. Notes are deliberately absent. */
const summaryColumns = {
  id: recipes.id,
  title: recipes.title,
  description: recipes.description,
  cuisine: recipes.cuisine,
  prepTimeMinutes: recipes.prepTimeMinutes,
  cookTimeMinutes: recipes.cookTimeMinutes,
  calories: recipes.calories,
  imageUrl: recipes.imageUrl,
  thumbnailUrl: recipes.thumbnailUrl,
  isAiGenerated: recipes.isAiGenerated,
};

export type SharedLibrary = {
  scope: ShareScope;
  recipes: SharedRecipeSummary[];
  cuisines: string[];
  tags: string[];
};

/** Everything the browse page needs, in one call. */
export async function getSharedLibrary(
  ctx: HouseholdContext,
  shareId: string
): Promise<SharedLibrary> {
  const scope = await loadShareScope(ctx.householdId, shareId);
  const predicate = shareScopePredicate(scope);

  const [rows, cuisineRows, tagRows] = await Promise.all([
    db.select(summaryColumns).from(recipes).where(predicate).orderBy(asc(recipes.title)),
    db
      .selectDistinct({ cuisine: recipes.cuisine })
      .from(recipes)
      .where(and(predicate, sql`${recipes.cuisine} is not null`)),
    // Only tags that actually occur on an in-scope recipe — an excluded tag
    // must not show up in the filter bar as if it were browsable.
    db
      .selectDistinct({ tag: recipeTags.tag })
      .from(recipeTags)
      .where(inArray(recipeTags.recipeId, db.select({ id: recipes.id }).from(recipes).where(predicate)))
      .orderBy(asc(recipeTags.tag)),
  ]);

  return {
    scope,
    recipes: rows,
    cuisines: cuisineRows.map((c) => c.cuisine).filter((c): c is string => !!c).sort(),
    tags: tagRows.map((t) => t.tag),
  };
}

export type SharedRecipeDetail = SharedRecipeSummary & {
  servings: string | null;
  servingsUnit: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
  proteinG: string | null;
  carbsG: string | null;
  fatG: string | null;
  sourceUrl: string | null;
  ingredients: {
    id: string;
    ingredientName: string;
    amount: string | null;
    unit: string | null;
    preparation: string | null;
    isOptional: boolean;
    groupLabel: string | null;
  }[];
  steps: {
    id: string;
    instruction: string;
    durationMinutes: number | null;
    timerLabel: string | null;
    groupLabel: string | null;
  }[];
  tags: string[];
};

/**
 * One recipe from a shared library.
 *
 * The scope predicate is applied here too, not just on the list — otherwise
 * guessing an id would reach a recipe the browse view deliberately hides.
 */
export async function getSharedRecipeDetail(
  ctx: HouseholdContext,
  shareId: string,
  recipeId: string
): Promise<SharedRecipeDetail> {
  const scope = await loadShareScope(ctx.householdId, shareId);

  const [recipe] = await db
    .select({
      ...summaryColumns,
      servings: recipes.servings,
      servingsUnit: recipes.servingsUnit,
      difficulty: recipes.difficulty,
      proteinG: recipes.proteinG,
      carbsG: recipes.carbsG,
      fatG: recipes.fatG,
      sourceUrl: recipes.sourceUrl,
    })
    .from(recipes)
    .where(and(shareScopePredicate(scope), eq(recipes.id, recipeId)))
    .limit(1);

  if (!recipe) throw new LibraryShareInvalidError();

  const [ingredients, steps, tags] = await Promise.all([
    db
      .select({
        id: recipeIngredients.id,
        ingredientName: recipeIngredients.ingredientName,
        amount: recipeIngredients.amount,
        unit: recipeIngredients.unit,
        preparation: recipeIngredients.preparation,
        isOptional: recipeIngredients.isOptional,
        groupLabel: recipeIngredients.groupLabel,
      })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeId))
      .orderBy(asc(recipeIngredients.position)),
    db
      .select({
        id: recipeSteps.id,
        instruction: recipeSteps.instruction,
        durationMinutes: recipeSteps.durationMinutes,
        timerLabel: recipeSteps.timerLabel,
        groupLabel: recipeSteps.groupLabel,
      })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipeId))
      .orderBy(asc(recipeSteps.position)),
    db.select({ tag: recipeTags.tag }).from(recipeTags).where(eq(recipeTags.recipeId, recipeId)),
  ]);

  return { ...recipe, ingredients, steps, tags: tags.map((t) => t.tag) };
}

/**
 * The owner's collections, but only those holding at least one in-scope
 * recipe — the sidebar must never advertise a collection whose contents are
 * all excluded.
 */
export async function listSharedCollections(ctx: HouseholdContext, shareId: string) {
  const scope = await loadShareScope(ctx.householdId, shareId);
  const predicate = shareScopePredicate(scope);

  return db
    .select({
      id: collections.id,
      name: collections.name,
      icon: collections.icon,
      description: collections.description,
      recipeCount: count(recipeCollections.recipeId),
    })
    .from(collections)
    .innerJoin(recipeCollections, eq(recipeCollections.collectionId, collections.id))
    .where(
      and(
        eq(collections.householdId, scope.ownerHouseholdId),
        inArray(
          recipeCollections.recipeId,
          db.select({ id: recipes.id }).from(recipes).where(predicate)
        )
      )
    )
    .groupBy(collections.id)
    .orderBy(desc(count(recipeCollections.recipeId)));
}
