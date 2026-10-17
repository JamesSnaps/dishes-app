import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import * as recipeService from "@/lib/services/recipes";

/**
 * POST `{ "minutes": 45 }` — the recipe's cook time, from how long a cook
 * actually took (the web does this when it differs by 5 minutes or more). 204.
 */
export const POST = withApiErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const { minutes } = z.object({ minutes: z.number().int().positive().max(24 * 60) }).parse(await req.json());
    await recipeService.updateRecipeCookTime(session, (await params).id, minutes);
    return new NextResponse(null, { status: 204 });
  }
);
