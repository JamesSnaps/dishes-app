import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { householdClock } from "@/lib/integration-meal-times";
import { addDaysToDate } from "@/lib/dinner-reminders/time";
import { publicOrigin } from "@/lib/public-origin";
import { listOutsideMeals } from "@/lib/services/outside-meals";
import {
  logMealOut,
  logOutsideMealSchema,
  noActingMember,
  outsideMealDetailJson,
  outsideMealErrorResponse,
} from "@/lib/integration-outside-meals";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Meals out in full, oldest first. ?from= and ?to= (YYYY-MM-DD, inclusive)
// default to the current week on the household's clock.
export const GET = withIntegrationAuth("read:meal_plan", async (req: NextRequest, ctx) => {
  const params = new URL(req.url).searchParams;
  for (const key of ["from", "to"]) {
    const v = params.get(key);
    if (v && (!DATE_RE.test(v) || Number.isNaN(Date.parse(v)))) {
      return NextResponse.json({ error: `${key} must be a date, YYYY-MM-DD` }, { status: 400 });
    }
  }
  const clock = await householdClock(ctx.householdId);
  const from = params.get("from") ?? clock.weekStartDate;
  const to = params.get("to") ?? addDaysToDate(clock.weekStartDate, 6);

  const origin = publicOrigin(req.headers);
  const meals = await listOutsideMeals(ctx.householdId, { from, to });
  return NextResponse.json({ from, to, meals: meals.map((m) => outsideMealDetailJson(m, origin)) });
});

// Log a meal out (logMealOut): 201 with action "created", or 200 with action
// "filled" when it filled the day's empty "Not cooking" slot. The nutrition
// estimate follows a few seconds later.
export const POST = withIntegrationAuth("write:outside_meals", async (req: NextRequest, ctx) => {
  if (!ctx.memberId) return noActingMember();

  try {
    const body = logOutsideMealSchema.parse(await req.json());
    const { action, meal } = await logMealOut({ householdId: ctx.householdId, memberId: ctx.memberId }, body, req);
    return NextResponse.json(
      { action, meal: outsideMealDetailJson(meal, publicOrigin(req.headers)) },
      { status: action === "filled" ? 200 : 201 }
    );
  } catch (err) {
    const res = outsideMealErrorResponse(err);
    if (res) return res;
    throw err;
  }
});
