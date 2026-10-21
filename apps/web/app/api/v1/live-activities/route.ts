import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { registerLiveActivity, unregisterLiveActivity } from "@/lib/live-activities";
import { registerShoppingTrip, unregisterShoppingTrip } from "@/lib/shopping-trip-activities";

const token = z.string().regex(/^[0-9a-fA-F]{32,400}$/);
const environment = z.enum(["sandbox", "production"]).default("production");
const registerSchema = z.union([
  z.object({ groupId: z.string().uuid(), token, environment }),
  z.object({ shoppingListId: z.string().uuid(), token, environment }),
]);

/**
 * POST — hand over a Live Activity's push token so the server keeps it
 * current: a meal schedule's `{ "groupId", "token", "environment" }`, or a
 * shopping trip's `{ "shoppingListId", "token", "environment" }`.
 * DELETE `{ "token" }` when the app ends it.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const input = registerSchema.parse(await req.json());
  if ("groupId" in input) {
    await registerLiveActivity({ ...input, householdId: session.householdId, memberId: session.memberId });
  } else {
    await registerShoppingTrip({
      token: input.token,
      environment: input.environment,
      householdId: session.householdId,
      listId: input.shoppingListId,
    });
  }
  return new NextResponse(null, { status: 204 });
});

export const DELETE = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const { token } = z.object({ token: z.string().min(1) }).parse(await req.json());
  await unregisterLiveActivity(token);
  await unregisterShoppingTrip(token, session.householdId);
  return new NextResponse(null, { status: 204 });
});
