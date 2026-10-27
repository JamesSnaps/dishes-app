import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { mealPlans, mealPlanEntries, mealPlanGroups, recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { withMealGroup } from "@/lib/integration-meal-groups";
import { householdClock, weekServeTimes } from "@/lib/integration-meal-times";
import { addDaysToDate, weekStartOf } from "@/lib/dinner-reminders/time";
import { outsideMealsJson } from "@/lib/integration-outside-meals";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Returns all meal plan entries for the household's current week.
// Optional ?week=YYYY-MM-DD query param to fetch a specific week (any date in
// it; the Monday is used).
export const GET = withIntegrationAuth(
  "read:meal_plan",
  async (req: NextRequest, ctx) => {
    const week = new URL(req.url).searchParams.get("week");
    if (week && (!DATE_RE.test(week) || Number.isNaN(Date.parse(week)))) {
      return NextResponse.json({ error: "week must be a date, YYYY-MM-DD" }, { status: 400 });
    }

    const clock = await householdClock(ctx.householdId);
    const weekStartDate = week ? weekStartOf(week) : clock.weekStartDate;

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

    const outsideMeals = await outsideMealsJson(ctx.householdId, weekStartDate, addDaysToDate(weekStartDate, 6));

    if (!plan) {
      return NextResponse.json({ weekStartDate, timezone: clock.timezone, entries: [], outsideMeals });
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
        .where(eq(mealPlanEntries.mealPlanId, plan.id)),
      weekServeTimes(ctx.householdId, weekStartDate, clock.settings),
    ]);

    return NextResponse.json({
      weekStartDate,
      timezone: clock.timezone,
      planStatus: plan.status,
      entries: entries.map(({ groupServeAt, ...entry }) =>
        withMealGroup({ ...entry, serveAt: serveAt({ ...entry, groupServeAt }) })
      ),
      outsideMeals,
    });
  }
);
