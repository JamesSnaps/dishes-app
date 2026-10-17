import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import * as collectionService from "@/lib/services/collections";

type RouteContext = { params: Promise<{ id: string; recipeId: string }> };

/** PUT — add the recipe to the collection (idempotent). DELETE — take it out. */
export const PUT = withApiErrors(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id, recipeId } = await ctx.params;
  await collectionService.addRecipe(session, id, recipeId);
  return new NextResponse(null, { status: 204 });
});

export const DELETE = withApiErrors(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id, recipeId } = await ctx.params;
  await collectionService.removeRecipe(session, id, recipeId);
  return new NextResponse(null, { status: 204 });
});
