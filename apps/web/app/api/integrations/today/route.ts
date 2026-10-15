import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { mealPlans, mealPlanEntries, mealPlanGroups, recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { withMealGroup } from "@/lib/integration-meal-groups";
import { getDeliveryConfig, getNextOpenDelivery } from "@/lib/deliveries/schedule";
import { nextDeliveryJson } from "@/lib/deliveries/json";
import { localNow } from "@/lib/dinner-reminders/time";

/** The next grocery order still open, or null when deliveries aren't set up. */
async function nextDelivery(householdId: string) {
  const config = await getDeliveryConfig(householdId);
  const report = await getNextOpenDelivery(householdId, config);
  return nextDeliveryJson(report, localNow(config.timezone).date);
}

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
      return NextResponse.json({
        date: today.toISOString().split("T")[0],
        meals: [],
        nextDelivery: await nextDelivery(ctx.householdId),
      });
    }

    const entries = await db
      .select({
        id: mealPlanEntries.id,
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
      .where(
        and(
          eq(mealPlanEntries.mealPlanId, plan.id),
          eq(mealPlanEntries.dayOfWeek, dayOfWeek)
        )
      );

    return NextResponse.json({
      date: today.toISOString().split("T")[0],
      meals: entries.map(withMealGroup),
      nextDelivery: await nextDelivery(ctx.householdId),
    });
  }
);
