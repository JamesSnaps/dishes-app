import { NextRequest, NextResponse } from "next/server";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { sendPushToEndpoint } from "@/lib/push";

export async function POST(req: NextRequest) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const body = await req.json().catch(() => ({}));
  const { endpoint } = body ?? {};

  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }

  try {
    const outcome = await sendPushToEndpoint(householdId, endpoint, {
      title: "Dishes test notification",
      body: "Push notifications are working on this device 🎉",
      url: "/settings",
    });

    console.info(`[push] test notification for ${user.username} → ${outcome}`);

    switch (outcome) {
      case "sent":
        return NextResponse.json({ ok: true });
      case "no_subscription":
        return NextResponse.json(
          { error: "No subscription found for this device — try disabling and re-enabling." },
          { status: 404 }
        );
      case "stale":
        return NextResponse.json(
          { error: "This device's subscription has expired — disable and re-enable notifications." },
          { status: 410 }
        );
      case "failed":
        return NextResponse.json(
          { error: "The push service rejected the notification. Check the web container logs for the reason." },
          { status: 502 }
        );
    }
  } catch (err) {
    // initVapid() throws when VAPID env vars are missing — surface that clearly.
    console.error("[push] test notification error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to send test notification";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
