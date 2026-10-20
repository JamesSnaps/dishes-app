import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { getAiContext } from "@/lib/services/ai-context";

/**
 * GET — the household's AI prompt inputs (measurement system, default prompt,
 * equipment, who's eating, taste profile, collection names) so the iOS app can
 * run the same prompts on the device. Never the key or the budget. Any member.
 */
export const GET = withApiErrors(async () => {
  const session = await requireSession();
  return NextResponse.json(await getAiContext(session));
});
