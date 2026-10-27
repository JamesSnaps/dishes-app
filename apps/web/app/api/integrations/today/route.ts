import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { mealPlans, mealPlanEntries, mealPlanGroups, recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { withMealGroup } from "@/lib/integration-meal-groups";
import { getDeliveryConfig, getNextOpenDelivery } from "@/lib/deliveries/schedule";
import { nextDeliveryJson } from "@/lib/deliveries/json";
import { localNow } from "@/lib/dinner-reminders/time";
import { householdClock, todayDinner, weekServeTimes } from "@/lib/integration-meal-times";
import { outsideMealsJson } from "@/lib/integration-outside-meals";

/** The next grocery order still open, or null when deliveries aren't set up. */
async function nextDelivery(householdId: string) {
  const config = await getDeliveryConfig(householdId);
  const report = await getNextOpenDelivery(householdId, config);
  return nextDeliveryJson(report, localNow(config.timezone).date);
}

// Returns today's meal plan entries for the household's active plan, with
// tonight's dinner and cooking start times on the household clock.
export const GET = withIntegrationAuth(
  "read:meal_plan",
  async (_req: NextRequest, ctx) => {
    const clock = await householdClock(ctx.householdId);
    const { today: date, dayOfWeek, weekStartDate } = clock;

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

    const [dinner, delivery, outsideMeals] = await Promise.all([
      todayDinner(ctx.householdId, clock),
      nextDelivery(ctx.householdId),
      outsideMealsJson(ctx.householdId, date, date),
    ]);

    if (!plan) {
      return NextResponse.json({
        date,
        timezone: clock.timezone,
        meals: [],
        outsideMeals,
        dinner,
        nextDelivery: delivery,
      });
    }

    const [entries, serveAt] = await Promise.all([
      db
        .select({
          id: mealPlanEntries.id,
          dayOfWeek: mealPlanEntries.dayOfWeek,
          mealType: mealPlanEntries.mealType,
          servings: mealPlanEntries.servings,
          notes: mealPlanEntries.notes,
          groupId: mealPlanGroups.id,
          groupTitle: mealPlanGroups.title,
          groupServeAt: mealPlanGroups.serveAt,
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
        ),
      weekServeTimes(ctx.householdId, weekStartDate, clock.settings),
    ]);

    return NextResponse.json({
      date,
      timezone: clock.timezone,
      meals: entries.map(({ dayOfWeek: _d, groupServeAt, ...entry }) =>
        withMealGroup({ ...entry, serveAt: serveAt({ dayOfWeek, mealType: entry.mealType, groupServeAt }) })
      ),
      outsideMeals,
      dinner,
      nextDelivery: delivery,
    });
  }
);
