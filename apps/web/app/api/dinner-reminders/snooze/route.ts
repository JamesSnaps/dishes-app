import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { getDinnerPlan, setDayDinner, getWeekDinnerSettings } from "@/lib/dinner-reminders/schedule";
import { SNOOZE_MINUTES } from "@/lib/dinner-reminders/scheduler";
import { dayOfWeekOf, minutesToTime, timeToMinutes, weekStartOf } from "@/lib/dinner-reminders/time";

/**
 * "Push back 30 min" from a dinner reminder notification. Called by the
 * service worker, so it answers JSON (never a redirect) and is idempotent
 * enough for a double tap to cost at most another 30 minutes.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { date?: unknown } | null;
  const date = typeof body?.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const week = await getWeekDinnerSettings(session.householdId, weekStartOf(date));
  const current = timeToMinutes(week[dayOfWeekOf(date)]!.time);
  // Never wrap past midnight into tomorrow morning.
  const pushed = minutesToTime(Math.min(current + SNOOZE_MINUTES, 23 * 60 + 59));

  await setDayDinner(session, date, { dinnerTime: pushed, reminderEnabled: true });
  const plan = await getDinnerPlan(session.householdId, date);

  return NextResponse.json({
    dinnerTime: plan.dinner.time,
    remindAt: plan.notifyAt !== null ? minutesToTime(Math.max(0, plan.notifyAt)) : null,
  });
}
