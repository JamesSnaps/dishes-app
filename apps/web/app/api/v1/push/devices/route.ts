import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { registerApnsDevice, unregisterApnsDevice } from "@/lib/services/notification-settings";

/**
 * POST — register this iPhone/iPad for Apple Push:
 * `{ "token": "<hex>", "environment": "sandbox" | "production", "deviceName": "…" }`.
 * Re-registering the same token (every launch) is a cheap upsert.
 * DELETE — `{ "token": "<hex>" }`, on sign-out.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  return NextResponse.json(await registerApnsDevice(session, await req.json()), { status: 201 });
});

export const DELETE = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const { token } = z.object({ token: z.string().min(1) }).parse(await req.json());
  await unregisterApnsDevice(session, token);
  return new NextResponse(null, { status: 204 });
});
