import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { getRecipe, RecipeNotFoundError } from "@/lib/services/recipes";
import { recipeDetailJson } from "@/lib/integration-recipes";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    return NextResponse.json({ recipe: recipeDetailJson(recipe) });
  })(req);
}
