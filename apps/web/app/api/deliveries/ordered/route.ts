import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { isValidDate, setDeliveryState, weekdayName } from "@/lib/deliveries/schedule";

/**
 * "Mark as ordered" from a delivery reminder notification. Called by the
 * service worker, so it answers JSON (never a redirect). Idempotent: marking
 * an ordered delivery again keeps its original order time.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Same rule as the other delivery changes (requireEditor in actions/deliveries.ts).
  if (session.role === "child") {
    return NextResponse.json({ error: "Ask an adult to change deliveries" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { date?: unknown } | null;
  const date = typeof body?.date === "string" ? body.date : "";
  if (!isValidDate(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  await setDeliveryState(session, date, "ordered");
  return NextResponse.json({ date, day: weekdayName(date) });
}
