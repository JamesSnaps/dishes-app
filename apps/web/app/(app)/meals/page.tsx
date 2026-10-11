import { db } from "@/lib/db";
import { recipes, recipeTags } from "@dishes/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { listMeals } from "@/lib/services/meals";
import { MealsManager } from "./_components/meals-manager";

export const metadata = { title: "Saved meals" };

export default async function MealsPage() {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const [savedMeals, recipeRows] = await Promise.all([
    listMeals({ householdId, memberId }),
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        cuisine: recipes.cuisine,
        difficulty: recipes.difficulty,
        thumbnailUrl: recipes.thumbnailUrl,
        imageUrl: recipes.imageUrl,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
        isFavourite: recipes.isFavourite,
      })
      .from(recipes)
      .where(eq(recipes.householdId, householdId))
      .orderBy(recipes.title),
  ]);

  const tagRows = recipeRows.length
    ? await db
        .select({ recipeId: recipeTags.recipeId, tag: recipeTags.tag })
        .from(recipeTags)
        .where(
          inArray(
            recipeTags.recipeId,
            recipeRows.map((r) => r.id)
          )
        )
    : [];

  const tagsByRecipe = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsByRecipe.get(row.recipeId) ?? [];
    list.push(row.tag);
    tagsByRecipe.set(row.recipeId, list);
  }

  // The picker's shape; ratings and ingredient search aren't needed here.
  const pickerRecipes = recipeRows.map((r) => ({
    ...r,
    tags: tagsByRecipe.get(r.id) ?? [],
    avgRating: null,
    ingredientNames: [],
  }));

  return <MealsManager savedMeals={savedMeals} recipes={pickerRecipes} />;
}
