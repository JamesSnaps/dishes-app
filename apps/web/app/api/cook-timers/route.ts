import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { setDeviceTimers, type DeviceTimer } from "@/lib/cook-timer-push";

/**
 * Cooking mode's running timers, handed over when the app goes into the
 * background (and an empty list when it comes back) so a timer that finishes
 * while you're away arrives as a push. See `lib/cook-timer-push.ts`.
 *
 * Called with `fetch(..., { keepalive: true })` while the page is being
 * hidden, so it answers JSON — never an Authelia redirect.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    deviceId?: unknown;
    timers?: unknown;
  } | null;
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId : "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(deviceId)) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }
  const timers = Array.isArray(body?.timers) ? (body.timers as DeviceTimer[]) : [];

  const scheduled = await setDeviceTimers(
    { householdId: session.householdId, memberId: session.memberId, user: session.user.username },
    deviceId,
    timers
  );
  return NextResponse.json({ scheduled });
}
