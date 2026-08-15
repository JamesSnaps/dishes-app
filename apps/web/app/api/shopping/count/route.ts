import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getUncheckedCount } from "@/lib/services/shopping";

export const dynamic = "force-dynamic";

/** Unchecked item count for the active list — feeds the nav badge. */
export async function GET() {
  const session = await requireSession();

  return NextResponse.json({ count: await getUncheckedCount(session) });
}
