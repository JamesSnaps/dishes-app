import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { updateCookSchema } from "@/lib/api/schemas/cook-history";
import { deleteCookEntry, updateCookEntry } from "@/lib/services/cook-history";

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withApiErrors(async (req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  await updateCookEntry(session, id, updateCookSchema.parse(await req.json()));

  return NextResponse.json({ ok: true });
});

export const DELETE = withApiErrors(async (_req: NextRequest, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  await deleteCookEntry(session, id);

  return new NextResponse(null, { status: 204 });
});
