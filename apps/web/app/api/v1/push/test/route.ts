import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apnsDevices } from "@dishes/db/schema";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { apiError, withApiErrors } from "@/lib/api/respond";
import { apnsConfigured, deliverToApnsDevices } from "@/lib/apns";

/** POST `{ "token": "<hex>" }` — send a test notification to this device. */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const { token } = z.object({ token: z.string().min(1) }).parse(await req.json());
  if (!apnsConfigured()) {
    return apiError("internal_error", "Apple Push isn't configured on the server (APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY).", 503);
  }
  const devices = await db
    .select()
    .from(apnsDevices)
    .where(
      and(
        eq(apnsDevices.token, token.toLowerCase()),
        eq(apnsDevices.householdId, session.householdId),
        eq(apnsDevices.autheliaUser, session.user.username)
      )
    );
  if (!devices.length) return apiError("not_found", "This device isn't registered for notifications.", 404);

  const result = await deliverToApnsDevices(devices, {
    title: "Dishes test notification",
    body: "Notifications are working on this device 🎉",
    url: "/settings/notifications",
    tag: "test",
  });
  console.info(`[apns] test for ${session.user.username} → sent=${result.sent} failed=${result.failed} stale=${result.stale}`);
  if (result.sent > 0) return NextResponse.json({ ok: true });
  if (result.stale > 0) return apiError("not_found", "Apple says this device token is no longer valid. Reopen the app to register again.", 410);
  return apiError("internal_error", "Apple rejected the notification. The server logs ([apns]) have the reason.", 502);
});
