import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { listCookingSessions } from "@/lib/cooking-sessions";

/**
 * GET — the household's cooks in progress, most recently changed first:
 * `{ "sessions": [CookingSession] }`. Read-only for everyone but the device
 * cooking (lib/cooking-sessions.ts).
 */
export const GET = withApiErrors(async () => {
  const session = await requireSession();
  const sessions = await listCookingSessions(session.householdId);
  return NextResponse.json({
    sessions: sessions.map(({ householdId: _h, memberId: _m, ...rest }) => rest),
  });
});
