import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { updateOutsideMealSchema } from "@/lib/api/schemas/outside-meals";
import { deleteOutsideMeal, getOutsideMeal, updateOutsideMeal } from "@/lib/services/outside-meals";
import { estimateInBackground } from "../estimate-later";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  return NextResponse.json(await getOutsideMeal(session, id));
});

/** Partial update. Changing what the meal was re-estimates it in the background. */
export const PATCH = withApiErrors(async (req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const { meal, staleEstimate } = await updateOutsideMeal(
    session,
    id,
    updateOutsideMealSchema.parse(await req.json())
  );
  if (staleEstimate) estimateInBackground(session, meal, req);
  return NextResponse.json(meal);
});

export const DELETE = withApiErrors(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  await deleteOutsideMeal(session, id);
  return new NextResponse(null, { status: 204 });
});
