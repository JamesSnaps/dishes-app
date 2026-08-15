import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { toggleItemSchema } from "@/lib/api/schemas/shopping";
import { toggleItem } from "@/lib/services/shopping";

export const POST = withApiErrors(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const { id } = await ctx.params;

    const { checked } = toggleItemSchema.parse(await req.json());
    await toggleItem(session, id, checked);

    return NextResponse.json({ ok: true });
  }
);
