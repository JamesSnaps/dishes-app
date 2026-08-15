import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { addItemSchema } from "@/lib/api/schemas/shopping";
import { addItem } from "@/lib/services/shopping";

export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const payload = addItemSchema.parse(await req.json());
  const item = await addItem(session, payload);

  return NextResponse.json({ item }, { status: 201 });
});
