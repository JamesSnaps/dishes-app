import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { entryShoppingSchema } from "@/lib/api/schemas/meal-plan";
import { addEntryToShoppingList } from "@/lib/services/meal-plan";

/**
 * Adds one planned meal's ingredients to the active shopping list, scaled to the
 * entry's servings. `forceInclude` re-runs only the named ingredients, for the
 * "add anyway" flow after a pantry skip.
 */
export const POST = withApiErrors(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const { id } = await ctx.params;

    const { forceInclude } = entryShoppingSchema.parse(
      await req.json().catch(() => ({}))
    );

    const result = await addEntryToShoppingList(session, id, { forceInclude });

    return NextResponse.json(result);
  }
);
