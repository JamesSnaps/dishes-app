import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { historyQuerySchema, logCookSchema } from "@/lib/api/schemas/cook-history";
import {
  getAverageDuration,
  getCookStats,
  getRecipeCookHistory,
  logCook,
} from "@/lib/services/cook-history";

/**
 * One recipe's cook history plus its derived stats. Returned together because a
 * recipe screen needs all three and a native client shouldn't pay three round
 * trips for them.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const { recipeId } = historyQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams)
  );

  const [entries, stats, averageDuration] = await Promise.all([
    getRecipeCookHistory(session.householdId, recipeId),
    getCookStats(session.householdId, recipeId),
    getAverageDuration(session.householdId, recipeId),
  ]);

  return NextResponse.json({ entries, stats, averageDuration });
});

/** Log a cook. Returns 201 with the new entry id. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const { recipeId, ...data } = logCookSchema.parse(await req.json());

  const { id } = await logCook(session, recipeId, data);

  return NextResponse.json({ id }, { status: 201 });
});
