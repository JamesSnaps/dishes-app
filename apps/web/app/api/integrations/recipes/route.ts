import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { RecipeValidationError } from "@/lib/services/recipes";
import { addRecipe, integrationRecipeSchema, RecipeInputError, searchRecipes } from "@/lib/integration-recipes";

// Search the library: ?q= matches titles, tags and ingredients (leave out for
// the most recently changed); ?limit= 1–100, default 20.
export const GET = withIntegrationAuth("read:meal_plan", async (req: NextRequest, ctx) => {
  const params = new URL(req.url).searchParams;
  const limit = params.get("limit");
  if (limit != null && !/^\d+$/.test(limit)) {
    return NextResponse.json({ error: "limit must be a whole number" }, { status: 400 });
  }
  const q = params.get("q")?.trim() || undefined;
  return NextResponse.json({ recipes: await searchRecipes(ctx.householdId, q, limit ? Number(limit) : undefined) });
});

// Add a recipe to the household library (addRecipe): 201 with the recipe as
// getRecipe returns it. The MCP server's createRecipe does the same.
export const POST = withIntegrationAuth("write:recipes", async (req: NextRequest, ctx) => {
  try {
    const body = integrationRecipeSchema.parse(await req.json());
    const recipe = await addRecipe({ householdId: ctx.householdId, memberId: ctx.memberId }, body);
    return NextResponse.json({ recipe }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Invalid recipe", issues: err.issues }, { status: 400 });
    }
    if (err instanceof SyntaxError) return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    if (err instanceof RecipeInputError || err instanceof RecipeValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
