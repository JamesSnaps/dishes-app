import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { householdClock } from "@/lib/integration-meal-times";
import { getDinerBrief, UnknownDinerError } from "@/lib/services/diner-brief";
import { renderDinerBrief } from "@/lib/diner-brief";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The diner brief: what an AI choosing from a menu should know about who's
// eating. Optional ?date=YYYY-MM-DD (defaults to today in the household's
// timezone) and ?members=Name,Name (defaults to everyone).
export const GET = withIntegrationAuth(
  "read:preferences",
  async (req: NextRequest, ctx) => {
    const params = new URL(req.url).searchParams;
    const dateParam = params.get("date");
    if (dateParam && (!DATE_RE.test(dateParam) || Number.isNaN(Date.parse(dateParam)))) {
      return NextResponse.json({ error: "date must be a date, YYYY-MM-DD" }, { status: 400 });
    }
    const date = dateParam ?? (await householdClock(ctx.householdId)).today;
    const diners = (params.get("members") ?? "").split(",");

    try {
      const brief = await getDinerBrief(ctx.householdId, { date, diners });
      return NextResponse.json({ ...brief, promptText: renderDinerBrief(brief) });
    } catch (err) {
      if (err instanceof UnknownDinerError) {
        return NextResponse.json({ error: err.message, members: err.known }, { status: 400 });
      }
      throw err;
    }
  }
);
