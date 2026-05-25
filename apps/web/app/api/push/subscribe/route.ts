import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export async function POST(req: NextRequest) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const body = await req.json();
  const { endpoint, p256dh, auth } = body ?? {};

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "endpoint, p256dh, and auth are required" }, { status: 400 });
  }

  const userAgent = req.headers.get("user-agent") ?? undefined;

  await db
    .insert(pushSubscriptions)
    .values({
      householdId,
      autheliaUser: user.username,
      endpoint,
      p256dh,
      auth,
      userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { householdId, autheliaUser: user.username, p256dh, auth, userAgent },
    });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const body = await req.json();
  const { endpoint } = body ?? {};

  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }

  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.householdId, householdId)
      )
    );

  return NextResponse.json({ ok: true });
}
