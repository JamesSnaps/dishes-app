import { db } from "@/lib/db";
import { mealPlans, mealPlanEntries, recipes, recipeTags, recipeIngredients, cookHistory, shoppingLists, shoppingListItems } from "@dishes/db/schema";
import { eq, and, inArray, count, avg } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { WeekPlanner } from "./_components/week-planner";

export const metadata = { title: "Meal Plan" };

function getMondayOf(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getTodayDayIndex(): number {
  const day = new Date().getDay(); // 0=Sun
  return day === 0 ? 6 : day - 1; // 0=Mon … 6=Sun
}

export default async function MealPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const { week } = await searchParams;
  const weekStartDate = getMondayOf(week);
  const currentWeekStart = getMondayOf();
  const isCurrentWeek = weekStartDate === currentWeekStart;

  const [plan] = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(
      and(
        eq(mealPlans.householdId, householdId),
        eq(mealPlans.weekStartDate, weekStartDate)
      )
    )
    .limit(1);

  const [allEntries, allRecipesRaw] = await Promise.all([
    plan
      ? db
          .select({
            id: mealPlanEntries.id,
            dayOfWeek: mealPlanEntries.dayOfWeek,
            mealType: mealPlanEntries.mealType,
            recipe: {
              id: recipes.id,
              title: recipes.title,
              prepTimeMinutes: recipes.prepTimeMinutes,
              cookTimeMinutes: recipes.cookTimeMinutes,
              servings: recipes.servings,
              imageUrl: recipes.imageUrl,
              thumbnailUrl: recipes.thumbnailUrl,
            },
          })
          .from(mealPlanEntries)
          .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
          .where(eq(mealPlanEntries.mealPlanId, plan.id))
      : Promise.resolve(
          [] as {
            id: string;
            dayOfWeek: number;
            mealType: "breakfast" | "lunch" | "dinner" | "dessert" | "snack";
            recipe: {
              id: string;
              title: string;
              prepTimeMinutes: number | null;
              cookTimeMinutes: number | null;
              servings: string | null;
              imageUrl: string | null;
              thumbnailUrl: string | null;
            };
          }[]
        ),
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

  // Fetch tags and avg ratings for picker
  const allRecipeIds = allRecipesRaw.map((r) => r.id);

  const [allTagRows, ratingRows] = await Promise.all([
    allRecipeIds.length
      ? db
          .select({ recipeId: recipeTags.recipeId, tag: recipeTags.tag })
          .from(recipeTags)
          .where(inArray(recipeTags.recipeId, allRecipeIds))
      : Promise.resolve([]),
    allRecipeIds.length
      ? db
          .select({ recipeId: cookHistory.recipeId, avgRating: avg(cookHistory.rating) })
          .from(cookHistory)
          .where(
            and(
              eq(cookHistory.householdId, householdId),
              inArray(cookHistory.recipeId, allRecipeIds)
            )
          )
          .groupBy(cookHistory.recipeId)
      : Promise.resolve([]),
  ]);

  const tagsByRecipe = new Map<string, string[]>();
  for (const row of allTagRows) {
    const arr = tagsByRecipe.get(row.recipeId) ?? [];
    arr.push(row.tag);
    tagsByRecipe.set(row.recipeId, arr);
  }

  const ratingByRecipe = new Map<string, number>();
  for (const row of ratingRows) {
    if (row.avgRating !== null) {
      ratingByRecipe.set(row.recipeId, parseFloat(String(row.avgRating)));
    }
  }

  const allRecipes = allRecipesRaw.map((r) => ({
    ...r,
    tags: tagsByRecipe.get(r.id) ?? [],
    avgRating: ratingByRecipe.get(r.id) ?? null,
  }));

  // Compute top ingredients for the week
  const recipeIds = [...new Set(allEntries.map((e) => e.recipe.id))];
  const ingredientRows = recipeIds.length
    ? await db
        .select({ ingredientName: recipeIngredients.ingredientName })
        .from(recipeIngredients)
        .where(inArray(recipeIngredients.recipeId, recipeIds))
    : [];

  const ingredientCounts: Record<string, number> = {};
  for (const row of ingredientRows) {
    const name = row.ingredientName.toLowerCase().trim();
    ingredientCounts[name] = (ingredientCounts[name] ?? 0) + 1;
  }
  const topIngredients = Object.entries(ingredientCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, cnt]) => ({ name, count: cnt }));

  // Count unchecked items in the active shopping list
  const activeList = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.status, "active")))
    .orderBy(shoppingLists.createdAt)
    .limit(1);

  const shoppingItemCount = activeList[0]
    ? await db
        .select({ value: count() })
        .from(shoppingListItems)
        .where(and(eq(shoppingListItems.listId, activeList[0].id), eq(shoppingListItems.isChecked, false)))
        .then((r) => r[0]?.value ?? 0)
    : 0;

  return (
    <WeekPlanner
      weekStartDate={weekStartDate}
      planId={plan?.id ?? null}
      entries={allEntries}
      recipes={allRecipes}
      isCurrentWeek={isCurrentWeek}
      todayDayIndex={isCurrentWeek ? getTodayDayIndex() : -1}
      topIngredients={topIngredients}
      shoppingItemCount={Number(shoppingItemCount)}
    />
  );
}
