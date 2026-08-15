import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import {
  recipeListQuerySchema,
  recipeWriteSchema,
  toWriteInput,
} from "@/lib/api/schemas/recipe";
import * as recipeService from "@/lib/services/recipes";

/**
 * Reference implementation for /api/v1. Every other domain follows this shape:
 * resolve the session, validate the payload, call the service, return JSON.
 * No domain logic in the route.
 */

export const GET = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const query = recipeListQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams)
  );

  const results = await recipeService.listRecipes(session, {
    q: query.q,
    cuisine: query.cuisine,
    favouritesOnly: query.favourites === "1",
    difficulty: query.difficulty,
    maxTotalMinutes: query.maxTime,
    tags: query.tags?.split(",").filter(Boolean),
    sort: query.sort,
    limit: query.limit,
    offset: query.offset,
  });

  return NextResponse.json({ recipes: results });
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const payload = recipeWriteSchema.parse(await req.json());
  const { recipeId } = await recipeService.createRecipe(session, toWriteInput(payload));

  const recipe = await recipeService.getRecipe(session, recipeId);

  return NextResponse.json({ recipe }, { status: 201 });
});
