import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  recipes,
  recipeIngredients,
  recipeSteps,
  recipeTags,
} from "@dishes/db/schema";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { updateRecipe } from "@/app/actions/recipes";
import { getAiConfig } from "@/app/actions/settings";
import { countCookAssistThreads } from "@/app/actions/cook-assist-threads";
import { RecipeForm } from "../../_components/recipe-form";
import type { ImageStyleValue } from "@/lib/image-styles";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata(_props: Props) {
  return { title: `Edit Recipe` };
}

export default async function EditRecipePage({ params }: Props) {
  const { id } = await params;
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipe, ingredients, steps, tags, allTagRows, aiConfig, assistThreadCount] = await Promise.all([
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
      .select({ tag: recipeTags.tag })
      .from(recipeTags)
      .where(eq(recipeTags.recipeId, id)),
    db
      .selectDistinct({ tag: recipeTags.tag })
      .from(recipeTags)
      .innerJoin(recipes, eq(recipeTags.recipeId, recipes.id))
      .where(eq(recipes.householdId, householdId))
      .orderBy(recipeTags.tag),
    getAiConfig(householdId),
    countCookAssistThreads(id),
  ]);

  if (!recipe) notFound();

  const action = updateRecipe.bind(null, id);

  return (
    <div className="mx-auto max-w-screen-xl p-4 lg:p-8">
      <Link
        href={`/recipes/${id}`}
        className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        {recipe.title}
      </Link>

      <RecipeForm
        action={action}
        heading="Edit Recipe"
        submitLabel="Save Changes"
        recipeId={id}
        defaultImageStyle={aiConfig?.imageStyle as ImageStyleValue | undefined}
        assistThreadCount={assistThreadCount}
        allTags={allTagRows.map((r) => r.tag)}
        defaults={{
          title: recipe.title,
          description: recipe.description ?? undefined,
          cuisine: recipe.cuisine ?? undefined,
          prepTimeMinutes: recipe.prepTimeMinutes,
          cookTimeMinutes: recipe.cookTimeMinutes,
          servings: recipe.servings ?? undefined,
          servingsUnit: recipe.servingsUnit ?? undefined,
          difficulty: recipe.difficulty ?? undefined,
          sourceUrl: recipe.sourceUrl ?? undefined,
          notes: recipe.notes ?? undefined,
          imageUrl: recipe.imageUrl ?? undefined,
          thumbnailUrl: recipe.thumbnailUrl ?? undefined,
          tags: tags.map((t) => t.tag),
          ingredients: ingredients.map((ing) => ({
            ingredientName: ing.ingredientName,
            amount: ing.amount ?? "",
            unit: ing.unit ?? "",
            preparation: ing.preparation ?? "",
            isOptional: ing.isOptional,
            groupLabel: ing.groupLabel ?? "",
          })),
          steps: steps.map((s) => ({
            instruction: s.instruction,
            durationMinutes: s.durationMinutes?.toString() ?? "",
            timerLabel: s.timerLabel ?? "",
          })),
        }}
      />
    </div>
  );
}
