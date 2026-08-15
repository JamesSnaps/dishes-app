import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { updateItemSchema } from "@/lib/api/schemas/shopping";
import { deleteItem, updateItem } from "@/lib/services/shopping";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withApiErrors(async (req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  await updateItem(session, id, updateItemSchema.parse(await req.json()));

  return NextResponse.json({ ok: true });
});

export const DELETE = withApiErrors(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  await deleteItem(session, id);

  return new NextResponse(null, { status: 204 });
});
