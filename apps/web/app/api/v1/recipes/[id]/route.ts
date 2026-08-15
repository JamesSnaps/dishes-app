import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { recipeWriteSchema, toWriteInput } from "@/lib/api/schemas/recipe";
import * as recipeService from "@/lib/services/recipes";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const recipe = await recipeService.getRecipe(session, id);

  return NextResponse.json({ recipe });
});

/**
 * Full replacement, not a partial patch — recipes are edited as a whole
 * document (ingredients and steps are positional child rows, so a partial
 * update has no coherent meaning for them).
 */
export const PUT = withApiErrors(async (req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const payload = recipeWriteSchema.parse(await req.json());
  await recipeService.updateRecipe(session, id, toWriteInput(payload));

  const recipe = await recipeService.getRecipe(session, id);

  return NextResponse.json({ recipe });
});

export const DELETE = withApiErrors(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  await recipeService.deleteRecipe(session, id);

  return new NextResponse(null, { status: 204 });
});
