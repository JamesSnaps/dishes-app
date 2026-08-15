import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { previewQuerySchema } from "@/lib/api/schemas/shopping";
import { previewShoppingGeneration } from "@/lib/services/shopping";

/** What /generate would add and skip, without writing anything. */
export const GET = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const { recipeId, servings } = previewQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams)
  );

  return NextResponse.json(
    await previewShoppingGeneration(session, recipeId, servings)
  );
});
