import { db } from "@/lib/db";
import { mealPlans, mealPlanEntries, recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { WeekPlanner } from "./_components/week-planner";

export const metadata = { title: "Meal Plan" };

function getMondayOf(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
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

  const [allEntries, allRecipes] = await Promise.all([
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
            },
          })
          .from(mealPlanEntries)
          .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
          .where(eq(mealPlanEntries.mealPlanId, plan.id))
      : Promise.resolve(
          [] as {
            id: string;
            dayOfWeek: number;
            mealType: "breakfast" | "lunch" | "dinner" | "snack";
            recipe: {
              id: string;
              title: string;
              prepTimeMinutes: number | null;
              cookTimeMinutes: number | null;
              servings: string | null;
            };
          }[]
        ),
    db
      .select({
        id: recipes.id,
        title: recipes.title,
        cuisine: recipes.cuisine,
      })
      .from(recipes)
      .where(eq(recipes.householdId, householdId))
      .orderBy(recipes.title),
  ]);

  return (
    <WeekPlanner
      weekStartDate={weekStartDate}
      planId={plan?.id ?? null}
      entries={allEntries}
      recipes={allRecipes}
      isCurrentWeek={isCurrentWeek}
      todayDayIndex={isCurrentWeek ? getTodayDayIndex() : -1}
    />
  );
}
