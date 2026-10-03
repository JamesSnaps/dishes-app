import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { getRecipe, RecipeNotFoundError } from "@/lib/services/recipes";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(value: string | null): number | null {
  return value == null ? null : Number(value);
}

// Returns one household recipe with ingredients and steps — the follow-up to
// /today and /meal-plan/week, which only carry a recipe summary.
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return withIntegrationAuth("read:meal_plan", async (_req, ctx) => {
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    let recipe: Awaited<ReturnType<typeof getRecipe>>;
    try {
      recipe = await getRecipe({ householdId: ctx.householdId }, id);
    } catch (err) {
      if (err instanceof RecipeNotFoundError) {
        return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
      }
      throw err;
    }

    const hasNutrition = recipe.calories != null || recipe.proteinG != null;

    return NextResponse.json({
      recipe: {
        id: recipe.id,
        title: recipe.title,
        description: recipe.description,
        cuisine: recipe.cuisine,
        difficulty: recipe.difficulty,
        servings: recipe.servings == null ? null : String(Number(recipe.servings)),
        servingsUnit: recipe.servingsUnit,
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        calories: recipe.calories,
        mealTypes: recipe.mealTypes ?? [],
        tags: recipe.tags,
        notes: recipe.notes,
        sourceUrl: recipe.sourceUrl,
        nutrition: hasNutrition
          ? {
              calories: recipe.calories,
              proteinG: num(recipe.proteinG),
              carbsG: num(recipe.carbsG),
              fatG: num(recipe.fatG),
              saturatedFatG: num(recipe.saturatedFatG),
              fiberG: num(recipe.fiberG),
              sugarG: num(recipe.sugarG),
              sodiumMg: num(recipe.sodiumMg),
            }
          : null,
        ingredients: recipe.ingredients.map((i) => ({
          id: i.id,
          ingredientName: i.ingredientName,
          amount: i.amount,
          unit: i.unit,
          preparation: i.preparation,
          isOptional: i.isOptional,
          groupLabel: i.groupLabel,
        })),
        steps: recipe.steps.map((s, index) => ({
          step: index + 1,
          instruction: s.instruction,
          durationMinutes: s.durationMinutes,
          timerLabel: s.timerLabel,
          groupLabel: s.groupLabel,
          ingredientIds: s.ingredientIds ?? [],
        })),
      },
    });
  })(req);
}
