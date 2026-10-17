import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { deductRecipeIngredients } from "@/app/actions/pantry";

/**
 * POST `{ "servings": 4 }` — "Mark ingredients as used from pantry" after a
 * cook: takes what the recipe used, at these servings, off the pantry. 204.
 */
export const POST = withApiErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    await requireSession();
    const { servings } = z.object({ servings: z.number().positive().max(1000) }).parse(await req.json());
    await deductRecipeIngredients((await params).id, servings);
    return new NextResponse(null, { status: 204 });
  }
);
