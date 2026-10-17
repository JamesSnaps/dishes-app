import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import {
  getNotificationSettings,
  notificationPrefSchema,
  setNotificationPref,
} from "@/lib/services/notification-settings";

/**
 * GET — every notification type with whether you get it, and the devices
 * (browsers, iPhones, iPads) they go to. PATCH — turn one type on or off:
 * `{ "type": "shopping_updated", "enabled": false }`.
 */
export const GET = withApiErrors(async () => {
  const session = await requireSession();
  return NextResponse.json(await getNotificationSettings(session));
});

export const PATCH = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  await setNotificationPref(session, notificationPrefSchema.parse(await req.json()));
  return NextResponse.json(await getNotificationSettings(session));
});
