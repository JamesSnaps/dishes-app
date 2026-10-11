import { notFound } from "next/navigation";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { recipes, recipeIngredients, recipeSteps, householdMembers } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { CookingMode } from "./_components/cooking-mode";
import { getAverageDuration } from "@/lib/services/cook-history";
import { getCookAssistThreads } from "@/app/actions/cook-assist-threads";
import { isStorageAvailable } from "@/lib/storage";
import { getActiveListItemNames } from "@/lib/services/shopping";
import { getGroupForCooking } from "@/lib/services/meal-plan";
import { getMealSchedule } from "@/lib/services/meal-timeline";
import { getReminderSettings } from "@/lib/dinner-reminders/schedule";
import { zonedEpoch } from "@/lib/dinner-reminders/time";

export const metadata = { title: "Cooking Mode" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ servings?: string; meal?: string }>;
}

export default async function CookPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { servings: servingsParam, meal: mealParam } = await searchParams;
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  // Cooking a planned meal: every dish starts together. A meal that has gone
  // (or doesn't contain this recipe) just means cooking this one on its own.
  const meal = mealParam
    ? await getGroupForCooking({ householdId, memberId }, mealParam)
        .then((m) => (m.dishes.some((d) => d.recipeId === id) ? m : null))
        .catch(() => null)
    : null;
  // Its schedule as real clock times, so cooking mode can say what's next.
  const schedule = meal
    ? await Promise.all([
        getMealSchedule({ householdId, memberId }, meal.groupId),
        getReminderSettings(householdId),
      ])
        .then(([s, settings]) => {
          if (!s.serveAt) return undefined;
          const serveAt = zonedEpoch(s.date, s.serveAt, settings.timezone);
          return {
            serveAt,
            cues: s.timeline.cues.map((c) => ({
              id: c.id,
              at: serveAt + c.offsetMinutes * 60_000,
              recipeId: c.recipeId,
              stepIndex: c.stepIndex,
              text: c.text,
            })),
          };
        })
        .catch(() => undefined)
    : undefined;
  const initialServings = servingsParam
    ? parseFloat(servingsParam)
    : meal?.dishes.find((d) => d.recipeId === id)?.servings;

  const [recipe, ingredients, steps, members, avgDuration, assistThreads, onShoppingList] =
    await Promise.all([
    db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, id))
      .orderBy(asc(recipeIngredients.position)),
    db
      .select()
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, id))
      .orderBy(asc(recipeSteps.position)),
    db
      .select({ id: householdMembers.id, displayName: householdMembers.displayName })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.isActive, true)))
      .orderBy(householdMembers.displayName),
    getAverageDuration(householdId, id),
    getCookAssistThreads(id),
    // So the checklist can show what the meal plan already put on the list,
    // before you tap rather than after.
    getActiveListItemNames({ householdId, memberId }),
  ]);

  if (!recipe) notFound();

  return (
    <CookingMode
      recipe={recipe}
      ingredients={ingredients}
      steps={steps}
      householdMembers={members}
      ownName={members.find((m) => m.id === memberId)?.displayName ?? null}
      avgDuration={avgDuration}
      storageAvailable={isStorageAvailable()}
      initialServings={initialServings}
      initialAssistThreads={assistThreads}
      onShoppingList={onShoppingList}
      meal={meal ? { ...meal, schedule } : undefined}
    />
  );
}
