import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { getActiveListWithItems } from "@/lib/services/shopping";

/** The household's active shopping list and its items. */
export const GET = withApiErrors(async () => {
  const session = await requireSession();

  return NextResponse.json(await getActiveListWithItems(session));
});
