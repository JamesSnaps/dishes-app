import { notFound } from "next/navigation";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { recipes, recipeIngredients, recipeSteps, householdMembers } from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { CookingMode } from "./_components/cooking-mode";

export const metadata = { title: "Cooking Mode" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CookPage({ params }: Props) {
  const { id } = await params;
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipe, ingredients, steps, members] = await Promise.all([
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
  ]);

  if (!recipe) notFound();

  return (
    <CookingMode
      recipe={recipe}
      ingredients={ingredients}
      steps={steps}
      householdMembers={members}
    />
  );
}
