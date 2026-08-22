import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { addEntrySchema } from "@/lib/api/schemas/meal-plan";
import { addEntry } from "@/lib/services/meal-plan";

/** Assigns a recipe to a day and meal slot, creating the week's plan if needed. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const { weekStartDate, recipeId, dayOfWeek, mealType, servings } = addEntrySchema.parse(
    await req.json()
  );

  const entryId = await addEntry(
    session,
    weekStartDate,
    recipeId,
    dayOfWeek,
    mealType,
    servings
  );

  return NextResponse.json({ entryId }, { status: 201 });
});
