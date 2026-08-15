import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { listIdSchema } from "@/lib/api/schemas/shopping";
import { archiveList } from "@/lib/services/shopping";

/** Archives a list; the next write creates a fresh active one. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();

  const { listId } = listIdSchema.parse(await req.json());
  await archiveList(session, listId);

  return NextResponse.json({ ok: true });
});
