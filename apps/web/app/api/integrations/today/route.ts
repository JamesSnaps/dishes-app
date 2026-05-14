import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { mealPlans, mealPlanEntries, recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";

// Returns today's meal plan entries for the household's active plan.
export const GET = withIntegrationAuth(
  "read:meal_plan",
  async (_req: NextRequest, ctx) => {
    const today = new Date();
    // day_of_week: 0=Mon … 6=Sun (matching schema)
    const dayOfWeek = (today.getDay() + 6) % 7;

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);
    const weekStartDate = weekStart.toISOString().split("T")[0]!;

    const [plan] = await db
      .select({ id: mealPlans.id })
      .from(mealPlans)
      .where(
        and(
          eq(mealPlans.householdId, ctx.householdId),
          eq(mealPlans.weekStartDate, weekStartDate)
        )
      )
      .limit(1);

    if (!plan) {
      return NextResponse.json({ date: today.toISOString().split("T")[0], meals: [] });
    }

    const entries = await db
      .select({
        id: mealPlanEntries.id,
        mealType: mealPlanEntries.mealType,
        servings: mealPlanEntries.servings,
        notes: mealPlanEntries.notes,
        recipe: {
          id: recipes.id,
          title: recipes.title,
          cuisine: recipes.cuisine,
          prepTimeMinutes: recipes.prepTimeMinutes,
          cookTimeMinutes: recipes.cookTimeMinutes,
        },
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          eq(mealPlanEntries.mealPlanId, plan.id),
          eq(mealPlanEntries.dayOfWeek, dayOfWeek)
        )
      );

    return NextResponse.json({
      date: today.toISOString().split("T")[0],
      meals: entries,
    });
  }
);
