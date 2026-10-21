import Link from "next/link";
import { Suspense } from "react";
import { Plus, UtensilsCrossed } from "lucide-react";
import { FolderOpen } from "lucide-react";
import { db } from "@/lib/db";
import {
  recipes,
  recipeTags,
  recipeIngredients,
  collections,
  recipeCollections,
  mealPlans,
  mealPlanEntries,
  mealPlanGroups,
  recipeSteps,
  cookHistory,
} from "@dishes/db/schema";
import { getCookStatsByRecipe } from "@/lib/services/cook-history";
import { heartHealthyCondition } from "@/lib/services/recipes";
import { isHeartHealthy } from "@/lib/heart-healthy";
import { eq, and, ilike, isNotNull, or, inArray, count, sql, desc, gte } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Button } from "@dishes/ui";
import { RecipeFilters } from "./_components/recipe-filters";
import { RecipesLocalGrid } from "./_components/recipes-local-grid";
import { mergeCaseVariants, parseTags } from "@/lib/recipe-filtering";
import { getSuggestedRecipes } from "@/lib/services/taste-profile";
import { NotificationsBell } from "@/components/notifications/notifications-bell";
import type { BrowseTonight } from "./_components/recipes-browse";

export const metadata = { title: "Recipes" };

interface Props {
  searchParams: Promise<{
    q?: string;
    cuisine?: string;
    role?: string;
    favourites?: string;
    heart?: string;
    difficulty?: string;
    maxTime?: string;
    tags?: string;
    sort?: string;
    view?: string;
  }>;
}

/** Monday of this week (YYYY-MM-DD) and today's index from Monday — as the planner stores them. */
function today(): { weekStartDate: string; dayOfWeek: number } {
  const d = new Date();
  const dayOfWeek = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayOfWeek);
  return { weekStartDate: d.toISOString().slice(0, 10), dayOfWeek };
}

const MEAL_ORDER = ["breakfast", "lunch", "dinner", "dessert", "snack"];

/**
 * Tonight's meal for browse mode, picked as the iOS app's TonightCard picks it
 * (PlanData.meals): each meal group is one meal and each ungrouped dish its
 * own, ordered by meal type then id; the first dinner, else the day's last
 * meal. A grouped meal cooks all its dishes together (`?meal=`).
 *
 * Once it's cooked — a cook logged today for every dish with steps (or every
 * dish, when none has any) — the next meal after it still to cook takes its
 * place (dessert after dinner); with none, it stays, marked `cooked`. The iOS
 * app's PlanData.tonight does the same.
 */
async function getTonight(householdId: string): Promise<BrowseTonight> {
  const { weekStartDate, dayOfWeek } = today();
  const rows = await db
    .select({
      entryId: mealPlanEntries.id,
      mealType: mealPlanEntries.mealType,
      mealRole: mealPlanEntries.mealRole,
      groupId: mealPlanGroups.id,
      groupTitle: mealPlanGroups.title,
      groupMealType: mealPlanGroups.mealType,
      serveAt: mealPlanGroups.serveAt,
      recipeId: recipes.id,
      title: recipes.title,
      imageUrl: recipes.imageUrl,
      thumbnailUrl: recipes.thumbnailUrl,
      prepTimeMinutes: recipes.prepTimeMinutes,
      cookTimeMinutes: recipes.cookTimeMinutes,
      hasSteps: sql<boolean>`exists (select 1 from ${recipeSteps} where ${recipeSteps.recipeId} = ${recipes.id})`,
    })
    .from(mealPlanEntries)
    .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
    .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
    .leftJoin(mealPlanGroups, eq(mealPlanEntries.groupId, mealPlanGroups.id))
    .where(
      and(
        eq(mealPlans.householdId, householdId),
        eq(mealPlans.weekStartDate, weekStartDate),
        eq(mealPlanEntries.dayOfWeek, dayOfWeek)
      )
    );

  const meals = new Map<string, { id: string; mealType: string; dishes: typeof rows }>();
  for (const row of rows) {
    const id = row.groupId ?? row.entryId;
    const meal = meals.get(id) ?? { id, mealType: row.groupMealType ?? row.mealType, dishes: [] };
    meal.dishes.push(row);
    meals.set(id, meal);
  }
  const order = (t: string) => (MEAL_ORDER.includes(t) ? MEAL_ORDER.indexOf(t) : 9);
  const sorted = [...meals.values()].sort(
    (a, b) => order(a.mealType) - order(b.mealType) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const dinner = sorted.findIndex((m) => m.mealType === "dinner");
  let index = dinner >= 0 ? dinner : sorted.length - 1;
  if (index < 0) return null;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const cookedRows = await db
    .selectDistinct({ recipeId: cookHistory.recipeId })
    .from(cookHistory)
    .where(
      and(
        eq(cookHistory.householdId, householdId),
        eq(cookHistory.source, "cook"),
        inArray(cookHistory.recipeId, [...new Set(rows.map((r) => r.recipeId))]),
        gte(cookHistory.cookedAt, startOfToday)
      )
    );
  const cookedToday = new Set(cookedRows.map((r) => r.recipeId));
  const isCooked = (m: (typeof sorted)[number]) => {
    const cookable = m.dishes.filter((d) => d.hasSteps);
    return (cookable.length ? cookable : m.dishes).every((d) => cookedToday.has(d.recipeId));
  };

  let cooked = isCooked(sorted[index]);
  if (cooked) {
    const next = sorted.findIndex((m, i) => i > index && m.dishes.some((d) => d.hasSteps) && !isCooked(m));
    if (next >= 0) {
      index = next;
      cooked = false;
    }
  }
  const meal = sorted[index];

  const main = meal.dishes.find((d) => d.mealRole === "main") ?? meal.dishes[0];
  const pictured = meal.dishes.find((d) => d.imageUrl) ?? main;
  return {
    mealType: meal.mealType,
    title: main.groupTitle ?? main.title,
    serveAt: main.serveAt ?? null,
    dishCount: meal.dishes.length,
    cookHref: `/recipes/${main.recipeId}/cook${main.groupId ? `?meal=${main.groupId}` : ""}`,
    recipeHref: `/recipes/${main.recipeId}`,
    cooked,
    imageUrl: pictured.thumbnailUrl ?? pictured.imageUrl,
    totalMinutes: (main.prepTimeMinutes ?? 0) + (main.cookTimeMinutes ?? 0) || null,
  };
}

export default async function RecipesPage({ searchParams }: Props) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const { role, q, cuisine, favourites, heart, difficulty, maxTime, tags, sort } = await searchParams;

  const conditions = [eq(recipes.householdId, householdId)];
  if (q?.trim()) {
    conditions.push(
      or(
        ilike(recipes.title, `%${q.trim()}%`),
        inArray(
          recipes.id,
          db.select({ id: recipeTags.recipeId }).from(recipeTags).where(ilike(recipeTags.tag, `%${q.trim()}%`))
        ),
        inArray(
          recipes.id,
          db
            .select({ id: recipeIngredients.recipeId })
            .from(recipeIngredients)
            .where(ilike(recipeIngredients.ingredientName, `%${q.trim()}%`))
        )
      )!
    );
  }
  if (role && ["main", "side", "sauce", "other"].includes(role)) conditions.push(eq(recipes.mealRole, role as "main" | "side" | "sauce" | "other"));
  // Case-insensitive, mirrored in lib/recipe-filtering.ts: free-text cuisines
  // and tags come in several capitalisations ("British" / "british").
  if (cuisine?.trim()) conditions.push(sql`lower(${recipes.cuisine}) = ${cuisine.trim().toLowerCase()}`);
  if (favourites === "1") conditions.push(eq(recipes.isFavourite, true));
  if (heart === "1") conditions.push(heartHealthyCondition());
  if (difficulty?.trim() && ["easy", "medium", "hard"].includes(difficulty)) {
    conditions.push(eq(recipes.difficulty, difficulty as "easy" | "medium" | "hard"));
  }
  if (maxTime?.trim()) {
    const maxMinutes = parseInt(maxTime);
    if (!isNaN(maxMinutes)) {
      conditions.push(
        and(
          or(isNotNull(recipes.prepTimeMinutes), isNotNull(recipes.cookTimeMinutes))!,
          sql`COALESCE(${recipes.prepTimeMinutes}, 0) + COALESCE(${recipes.cookTimeMinutes}, 0) <= ${maxMinutes}`
        )!
      );
    }
  }
  if (tags?.trim()) {
    const tagList = parseTags(tags).map((t) => t.toLowerCase());
    if (tagList.length > 0) {
      conditions.push(
        inArray(
          recipes.id,
          db
            .select({ id: recipeTags.recipeId })
            .from(recipeTags)
            .where(inArray(sql`lower(${recipeTags.tag})`, tagList))
        )
      );
    }
  }

  const now = new Date();
  // Wrapped is brought to the front in December and January (the year just gone).
  const wrappedYear = now.getMonth() === 11 ? now.getFullYear() : now.getMonth() === 0 ? now.getFullYear() - 1 : null;

  const [allRecipes, totalCountRows, cuisineRows, cookStatsRows, tagRows, collectionRows, tonight, suggested] = await Promise.all([
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        description: recipes.description,
        cuisine: recipes.cuisine,
        mealRole: recipes.mealRole,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
        calories: recipes.calories,
        saturatedFatG: recipes.saturatedFatG,
        fiberG: recipes.fiberG,
        imageUrl: recipes.imageUrl,
        thumbnailUrl: recipes.thumbnailUrl,
        isFavourite: recipes.isFavourite,
        isAiGenerated: recipes.isAiGenerated,
        createdAt: recipes.createdAt,
      })
      .from(recipes)
      .where(and(...conditions))
      .orderBy(desc(recipes.createdAt)),
    // Unfiltered household total, so the header can say "12 of 128" rather than
    // only ever reporting what the current filters left behind.
    db
      .select({ total: count() })
      .from(recipes)
      .where(eq(recipes.householdId, householdId)),
    db
      .select({ cuisine: recipes.cuisine, count: count() })
      .from(recipes)
      .where(
        and(eq(recipes.householdId, householdId), isNotNull(recipes.cuisine))
      )
      .groupBy(recipes.cuisine),
    getCookStatsByRecipe(householdId),
    db
      .select({ tag: recipeTags.tag, count: count() })
      .from(recipeTags)
      .innerJoin(recipes, eq(recipeTags.recipeId, recipes.id))
      .where(eq(recipes.householdId, householdId))
      .groupBy(recipeTags.tag)
      .orderBy(recipeTags.tag),
    db
      .select({
        id: collections.id,
        name: collections.name,
        icon: collections.icon,
        recipeCount: count(recipeCollections.recipeId),
      })
      .from(collections)
      .leftJoin(recipeCollections, eq(recipeCollections.collectionId, collections.id))
      .where(eq(collections.householdId, householdId))
      .groupBy(collections.id, collections.icon)
      .orderBy(collections.name),
    getTonight(householdId).catch(() => null),
    getSuggestedRecipes(householdId).catch(() => []),
  ]);

  const cookStatsByRecipe = new Map(
    cookStatsRows.map((r) => [
      r.recipeId,
      { averageRating: r.averageRating, cookCount: r.cookCount, lastCookedAt: r.lastCookedAt },
    ])
  );

  const totalRecipes = Number(totalCountRows[0]?.total ?? 0);
  const isFiltered = allRecipes.length !== totalRecipes;

  const cuisineOptions = mergeCaseVariants(
    cuisineRows.flatMap((r) => (r.cuisine ? [{ value: r.cuisine, count: Number(r.count) }] : []))
  );
  const tagOptions = mergeCaseVariants(
    tagRows.flatMap((r) => (r.tag ? [{ value: r.tag, count: Number(r.count) }] : []))
  );

  const allTags = tagRows
    .map((r) => r.tag)
    .filter((t): t is string => Boolean(t));

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Recipes</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {totalRecipes === 0
              ? "Nothing in the collection yet"
              : isFiltered
                ? `${allRecipes.length} of ${totalRecipes} recipes`
                : `${totalRecipes} ${totalRecipes === 1 ? "recipe" : "recipes"} in your collection`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* On a phone there's no side nav, so the bell lives here. */}
          <div className="lg:hidden">
            <NotificationsBell />
          </div>
          <Button
            asChild
            size="sm"
            className="bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white border-0 shadow-sm"
          >
            <Link href="/meals" aria-label="Saved meals">
              <UtensilsCrossed className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Saved meals</span>
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/recipes/new" aria-label="New Recipe">
              <Plus className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">New Recipe</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Collections strip */}
      {collectionRows.length > 0 && (
        <div className="mb-4 -mx-4 px-4 lg:-mx-8 lg:px-8">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <Link
              href="/collections"
              className="flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Collections
            </Link>
            <div className="w-px h-5 bg-border shrink-0" />
            {collectionRows.map((col) => (
              <Link
                key={col.id}
                href={`/collections/${col.id}`}
                className="flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm hover:border-primary/40 hover:bg-primary/5 transition-colors"
              >
                <span className="leading-none">{col.icon ?? "📁"}</span>
                <span className="font-medium">{col.name}</span>
                <span className="text-xs text-muted-foreground">
                  {Number(col.recipeCount)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <Suspense>
        <RecipeFilters cuisines={cuisineOptions} tags={tagOptions} />
      </Suspense>

      {/* Results */}
      {allRecipes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-muted-foreground">
            {q || cuisine || favourites || heart || difficulty || maxTime || tags
              ? "No recipes match your filters."
              : "No recipes yet. Add your first one!"}
          </p>
          {!q && !cuisine && !favourites && !heart && !difficulty && !maxTime && !tags && (
            <Button asChild className="mt-4">
              <Link href="/recipes/new">Add a recipe</Link>
            </Button>
          )}
        </div>
      ) : (
        <RecipesLocalGrid
          initial={allRecipes
            .map((recipe) => {
              const stats = cookStatsByRecipe.get(recipe.id);
              return {
                ...recipe,
                createdAt: recipe.createdAt?.toISOString() ?? null,
                heartHealthy: isHeartHealthy(recipe),
                averageRating: stats?.averageRating ?? null,
                cookCount: stats?.cookCount ?? 0,
                lastCookedAt: stats?.lastCookedAt ?? null,
              };
            })
            .sort((a, b) => {
              if (sort === "az") return a.title.localeCompare(b.title);
              if (sort === "rating") return (b.averageRating ?? -1) - (a.averageRating ?? -1);
              if (sort === "cooked") return (b.lastCookedAt ?? "").localeCompare(a.lastCookedAt ?? "");
              return 0; // newest: DB already returns desc(createdAt)
            })}
          allTags={allTags}
          browse={{
            tonight,
            suggested: suggested.map((s) => ({ id: s.id, whyText: s.whyText ?? null })),
            wrappedYear,
          }}
        />
      )}
    </div>
  );
}

