import { db } from "@/lib/db";
import { recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getCookStatsByRecipe } from "@/lib/services/cook-history";
import { FavouritesGrid, type FavouriteRecipe } from "./_components/favourites-grid";
import { FavouritesHeader } from "./_components/favourites-header";

export const metadata = { title: "Favourites" };

/**
 * Still server-rendered, so first paint is immediate and works with no local
 * store. The grid then prefers the synced copy once the engine has data, which
 * is what makes returning to this page instant instead of a round-trip.
 */
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
        calories: recipes.calories,
        imageUrl: recipes.imageUrl,
        thumbnailUrl: recipes.thumbnailUrl,
        isFavourite: recipes.isFavourite,
        isAiGenerated: recipes.isAiGenerated,
      })
      .from(recipes)
      .where(
        and(eq(recipes.householdId, householdId), eq(recipes.isFavourite, true))
      )
      .orderBy(recipes.title),
    getCookStatsByRecipe(householdId),
  ]);

  const statsByRecipe = new Map(cookStatsRows.map((r) => [r.recipeId, r]));

  const initial: FavouriteRecipe[] = favouriteRecipes.map((recipe) => ({
    ...recipe,
    averageRating: statsByRecipe.get(recipe.id)?.averageRating ?? null,
    cookCount: statsByRecipe.get(recipe.id)?.cookCount ?? 0,
  }));

  return (
    <div className="p-4 lg:p-8">
      <FavouritesHeader initialCount={initial.length} />
      <FavouritesGrid initial={initial} />
    </div>
  );
}
