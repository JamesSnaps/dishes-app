import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { registerLiveActivity, unregisterLiveActivity } from "@/lib/live-activities";

const registerSchema = z.object({
  groupId: z.string().uuid(),
  token: z.string().regex(/^[0-9a-fA-F]{32,400}$/),
  environment: z.enum(["sandbox", "production"]).default("production"),
});

/**
 * POST — hand over a meal-schedule Live Activity's push token so the server
 * keeps it current: `{ "groupId", "token", "environment" }`. DELETE `{ "token" }`
 * when the app ends it.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const input = registerSchema.parse(await req.json());
  await registerLiveActivity({ ...input, householdId: session.householdId, memberId: session.memberId });
  return new NextResponse(null, { status: 204 });
});

export const DELETE = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const { token } = z.object({ token: z.string().min(1) }).parse(await req.json());
  await unregisterLiveActivity(token);
  return new NextResponse(null, { status: 204 });
});
