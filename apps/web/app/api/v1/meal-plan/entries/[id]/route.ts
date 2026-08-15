import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { updateEntrySchema } from "@/lib/api/schemas/meal-plan";
import {
  changeEntryType,
  moveEntry,
  removeEntry,
  updateEntryServings,
} from "@/lib/services/meal-plan";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Moves an entry between days, changes its meal slot, or sets its servings.
 * Each field maps to a distinct service call; they are applied in a fixed order
 * so a body combining all three behaves predictably.
 */
export const PATCH = withApiErrors(async (req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const body = updateEntrySchema.parse(await req.json());

  if (body.dayOfWeek !== undefined) await moveEntry(session, id, body.dayOfWeek);
  if (body.mealType !== undefined) await changeEntryType(session, id, body.mealType);
  if (body.servings !== undefined) {
    await updateEntryServings(session, id, body.servings);
  }

  return NextResponse.json({ ok: true });
});

export const DELETE = withApiErrors(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  await removeEntry(session, id);

  return new NextResponse(null, { status: 204 });
});
