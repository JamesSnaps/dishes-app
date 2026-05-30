import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { FolderOpen } from "lucide-react";
import { db } from "@/lib/db";
import { recipes, cookHistory, recipeTags, collections, recipeCollections } from "@dishes/db/schema";
import { eq, and, ilike, isNotNull, or, inArray, avg, count, sql, desc } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { Button } from "@dishes/ui";
import { RecipeFilters } from "./_components/recipe-filters";
import { RecipesGrid } from "./_components/recipes-grid";
import { CrumbImportModal } from "./_components/crumb-import-modal";

export const metadata = { title: "Recipes" };

interface Props {
  searchParams: Promise<{
    q?: string;
    cuisine?: string;
    favourites?: string;
    difficulty?: string;
    maxTime?: string;
    tags?: string;
    sort?: string;
  }>;
}

export default async function RecipesPage({ searchParams }: Props) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const { q, cuisine, favourites, difficulty, maxTime, tags, sort } = await searchParams;

  const conditions = [eq(recipes.householdId, householdId)];
  if (q?.trim()) {
    conditions.push(
      or(
        ilike(recipes.title, `%${q.trim()}%`),
        inArray(
          recipes.id,
          db.select({ id: recipeTags.recipeId }).from(recipeTags).where(ilike(recipeTags.tag, `%${q.trim()}%`))
        )
      )!
    );
  }
  if (cuisine?.trim()) conditions.push(eq(recipes.cuisine, cuisine.trim()));
  if (favourites === "1") conditions.push(eq(recipes.isFavourite, true));
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
    const tagList = tags.split(",").filter(Boolean);
    if (tagList.length > 0) {
      conditions.push(
        inArray(
          recipes.id,
          db.select({ id: recipeTags.recipeId }).from(recipeTags).where(inArray(recipeTags.tag, tagList))
        )
      );
    }
  }

  const [allRecipes, cuisineRows, cookStatsRows, tagRows, collectionRows] = await Promise.all([
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        description: recipes.description,
        cuisine: recipes.cuisine,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
        imageUrl: recipes.imageUrl,
        thumbnailUrl: recipes.thumbnailUrl,
        isFavourite: recipes.isFavourite,
        isAiGenerated: recipes.isAiGenerated,
      })
      .from(recipes)
      .where(and(...conditions))
      .orderBy(desc(recipes.createdAt)),
    db
      .selectDistinct({ cuisine: recipes.cuisine })
      .from(recipes)
      .where(
        and(eq(recipes.householdId, householdId), isNotNull(recipes.cuisine))
      )
      .orderBy(recipes.cuisine),
    db
      .select({
        recipeId: cookHistory.recipeId,
        averageRating: avg(cookHistory.rating),
        cookCount: count(cookHistory.id),
      })
      .from(cookHistory)
      .where(eq(cookHistory.householdId, householdId))
      .groupBy(cookHistory.recipeId),
    db
      .selectDistinct({ tag: recipeTags.tag })
      .from(recipeTags)
      .innerJoin(recipes, eq(recipeTags.recipeId, recipes.id))
      .where(eq(recipes.householdId, householdId))
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
  ]);

  const cookStatsByRecipe = new Map(
    cookStatsRows.map((r) => [
      r.recipeId,
      {
        averageRating:
          r.averageRating != null
            ? Math.round(parseFloat(r.averageRating) * 10) / 10
            : null,
        cookCount: Number(r.cookCount),
      },
    ])
  );

  const cuisines = cuisineRows
    .map((r) => r.cuisine)
    .filter((c): c is string => Boolean(c));

  const allTags = tagRows
    .map((r) => r.tag)
    .filter((t): t is string => Boolean(t));

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recipes</h1>
        <div className="flex items-center gap-2">
          <CrumbImportModal />
          <Button asChild size="sm">
            <Link href="/recipes/new">
              <Plus className="mr-1 h-4 w-4" />
              New Recipe
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
        <RecipeFilters cuisines={cuisines} tags={allTags} />
      </Suspense>

      {/* Results */}
      {allRecipes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="text-muted-foreground">
            {q || cuisine || favourites || difficulty || maxTime || tags
              ? "No recipes match your filters."
              : "No recipes yet. Add your first one!"}
          </p>
          {!q && !cuisine && !favourites && !difficulty && !maxTime && !tags && (
            <Button asChild className="mt-4">
              <Link href="/recipes/new">Add a recipe</Link>
            </Button>
          )}
        </div>
      ) : (
        <RecipesGrid
          recipes={allRecipes
            .map((recipe) => {
              const stats = cookStatsByRecipe.get(recipe.id);
              return {
                ...recipe,
                averageRating: stats?.averageRating ?? null,
                cookCount: stats?.cookCount ?? 0,
              };
            })
            .sort((a, b) => {
              if (sort === "az") return a.title.localeCompare(b.title);
              if (sort === "rating") return (b.averageRating ?? -1) - (a.averageRating ?? -1);
              return 0; // newest: DB already returns desc(createdAt)
            })}
          allTags={allTags}
        />
      )}
    </div>
  );
}
