import { db } from "@/lib/db";
import { recipes, cookHistory } from "@dishes/db/schema";
import { eq, and, avg, count } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { RecipeCard } from "../recipes/_components/recipe-card";
import Link from "next/link";
import { Heart } from "lucide-react";

export const metadata = { title: "Favourites" };

export default async function FavouritesPage() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [favouriteRecipes, cookStatsRows] = await Promise.all([
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        description: recipes.description,
        cuisine: recipes.cuisine,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
        imageUrl: recipes.imageUrl,
        isFavourite: recipes.isFavourite,
        isAiGenerated: recipes.isAiGenerated,
      })
      .from(recipes)
      .where(
        and(eq(recipes.householdId, householdId), eq(recipes.isFavourite, true))
      )
      .orderBy(recipes.title),
    db
      .select({
        recipeId: cookHistory.recipeId,
        averageRating: avg(cookHistory.rating),
        cookCount: count(cookHistory.id),
      })
      .from(cookHistory)
      .where(eq(cookHistory.householdId, householdId))
      .groupBy(cookHistory.recipeId),
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

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Favourites</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {favouriteRecipes.length} recipe{favouriteRecipes.length !== 1 ? "s" : ""}
        </p>
      </div>

      {favouriteRecipes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <Heart className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground">No favourites yet.</p>
          <p className="text-sm text-muted-foreground/60">
            Tap the heart on any{" "}
            <Link href="/recipes" className="underline underline-offset-2 hover:text-foreground">
              recipe
            </Link>{" "}
            to save it here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {favouriteRecipes.map((recipe) => {
            const stats = cookStatsByRecipe.get(recipe.id);
            return (
              <RecipeCard
                key={recipe.id}
                {...recipe}
                averageRating={stats?.averageRating ?? null}
                cookCount={stats?.cookCount ?? 0}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
