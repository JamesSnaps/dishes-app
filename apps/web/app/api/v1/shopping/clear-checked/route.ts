import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { listIdSchema } from "@/lib/api/schemas/shopping";
import { clearChecked } from "@/lib/services/shopping";

/** Removes every checked item from a list. Returns how many went. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const { listId } = listIdSchema.parse(await req.json());
  const cleared = await clearChecked(session, listId);

  return NextResponse.json({ cleared });
});
