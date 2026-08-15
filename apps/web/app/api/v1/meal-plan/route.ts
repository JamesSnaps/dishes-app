import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { weekQuerySchema } from "@/lib/api/schemas/meal-plan";
import { getWeek } from "@/lib/services/meal-plan";

/**
 * A week's plan and its entries. `week` is the Monday the week starts on.
 * Returns `{ "plan": null, "entries": [] }` for a week never planned.
 */
export const GET = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const { week } = weekQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams)
  );

  return NextResponse.json(await getWeek(session, week));
});
