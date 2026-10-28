import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors, apiError } from "@/lib/api/respond";
import { photoSlotSchema } from "@/lib/api/schemas/outside-meals";
import { getOutsideMeal, setOutsideMealPhoto } from "@/lib/services/outside-meals";
import { estimateInBackground } from "@/lib/outside-meal-estimate-later";

/**
 * A photo of the plate (`?slot=plate`, the default), of the menu
 * (`?slot=menu`) or of one course (`?slot=course&course=<id>`), as a raw image
 * body like the cook photo. Any of them changes what the estimator sees, so
 * the meal is re-estimated in the background.
 */
export const POST = withApiErrors(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const { id } = await ctx.params;
    const { slot, course } = photoSlotSchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const contentType = req.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.byteLength === 0) {
      return apiError("invalid_request", "Empty request body", 400);
    }

    const { url } = await setOutsideMealPhoto(session, id, slot, raw, contentType, course);
    estimateInBackground(session, await getOutsideMeal(session, id), req);
    return NextResponse.json({ url });
  }
);
