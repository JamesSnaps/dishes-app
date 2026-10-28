import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { createOutsideMealSchema, outsideMealRangeSchema } from "@/lib/api/schemas/outside-meals";
import { createOutsideMeal, listOutsideMeals } from "@/lib/services/outside-meals";
import { estimateInBackground } from "@/lib/outside-meal-estimate-later";

/** Outside meals in a date range (both ends optional, inclusive), oldest first. */
export const GET = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const range = outsideMealRangeSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json({ meals: await listOutsideMeals(session.householdId, range) });
});

/**
 * Log (or plan) a meal not cooked from the library. → 201 with the meal. The
 * household's AI estimates its nutrition once the reply has gone, and the
 * numbers follow in the next sync — unless figures were typed in.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const meal = await createOutsideMeal(session, createOutsideMealSchema.parse(await req.json()));
  estimateInBackground(session, meal, req);
  return NextResponse.json(meal, { status: 201 });
});
