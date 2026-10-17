import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { apiError, withApiErrors } from "@/lib/api/respond";
import { getMealClock } from "@/lib/services/meal-clock";

/**
 * GET — a planned meal's cooking schedule as clock times (epoch ms): when to
 * start each step so everything is ready at `serveAt`. 404 when the meal has
 * no serve-at time.
 */
export const GET = withApiErrors(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const clock = await getMealClock(session, (await params).id);
    if (!clock) return apiError("not_found", "This meal has no serve-at time", 404);
    return NextResponse.json(clock);
  }
);
