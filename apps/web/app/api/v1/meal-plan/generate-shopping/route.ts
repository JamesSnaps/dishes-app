import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { generateWeekShoppingSchema } from "@/lib/api/schemas/meal-plan";
import { generateShoppingFromWeek } from "@/lib/services/meal-plan";

/**
 * Aggregates every not-yet-added entry in a plan into the active shopping list,
 * combining the same ingredient across recipes into one line.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const { mealPlanId, forceInclude } = generateWeekShoppingSchema.parse(
    await req.json()
  );

  const result = await generateShoppingFromWeek(session, mealPlanId, { forceInclude });

  return NextResponse.json(result);
});
