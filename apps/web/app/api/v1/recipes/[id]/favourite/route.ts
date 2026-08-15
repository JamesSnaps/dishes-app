import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import * as recipeService from "@/lib/services/recipes";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const isFavourite = await recipeService.toggleFavourite(session, id);

  return NextResponse.json({ isFavourite });
});
