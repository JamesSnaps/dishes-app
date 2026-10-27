import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { estimateOutsideMealNutrition } from "@/lib/services/outside-meals";

/**
 * Estimate now and wait for it — for a client showing the figures straight
 * away. → the meal with its nutrition. 400 when there's nothing to estimate
 * from or no AI key; typed-in figures come back untouched.
 */
export const POST = withApiErrors(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const { id } = await ctx.params;
    return NextResponse.json(await estimateOutsideMealNutrition(session, id));
  }
);
