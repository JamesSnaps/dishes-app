import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { mealPlans, mealPlanEntries, mealPlanGroups, recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { withMealGroup } from "@/lib/integration-meal-groups";

// Returns all meal plan entries for the current ISO week.
// Optional ?week=YYYY-MM-DD query param to fetch a specific week (Monday date).
export const GET = withIntegrationAuth(
  "read:meal_plan",
  async (req: NextRequest, ctx) => {
    const { searchParams } = new URL(req.url);
    let weekStartDate = searchParams.get("week");

    if (!weekStartDate) {
      const today = new Date();
      const dayOfWeek = (today.getDay() + 6) % 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - dayOfWeek);
      weekStartDate = monday.toISOString().split("T")[0]!;
    }

    const [plan] = await db
      .select({ id: mealPlans.id, status: mealPlans.status, notes: mealPlans.notes })
      .from(mealPlans)
      .where(
        and(
          eq(mealPlans.householdId, ctx.householdId),
          eq(mealPlans.weekStartDate, weekStartDate)
        )
      )
      .limit(1);

    if (!plan) {
      return NextResponse.json({ weekStartDate, entries: [] });
    }

    const entries = await db
      .select({
        id: mealPlanEntries.id,
        dayOfWeek: mealPlanEntries.dayOfWeek,
        mealType: mealPlanEntries.mealType,
        servings: mealPlanEntries.servings,
        notes: mealPlanEntries.notes,
        groupId: mealPlanGroups.id,
        groupTitle: mealPlanGroups.title,
        mealRole: mealPlanEntries.mealRole,
        recipe: {
          id: recipes.id,
          title: recipes.title,
          cuisine: recipes.cuisine,
          prepTimeMinutes: recipes.prepTimeMinutes,
          cookTimeMinutes: recipes.cookTimeMinutes,
          calories: recipes.calories,
        },
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .leftJoin(mealPlanGroups, eq(mealPlanEntries.groupId, mealPlanGroups.id))
      .where(eq(mealPlanEntries.mealPlanId, plan.id));

    return NextResponse.json({ weekStartDate, planStatus: plan.status, entries: entries.map(withMealGroup) });
  }
);
