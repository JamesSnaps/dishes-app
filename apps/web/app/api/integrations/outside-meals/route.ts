import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { householdClock } from "@/lib/integration-meal-times";
import { addDaysToDate } from "@/lib/dinner-reminders/time";
import { publicOrigin } from "@/lib/public-origin";
import { isOutsideMealDescribed } from "@/lib/outside-meals";
import { createOutsideMeal, listOutsideMeals, updateOutsideMeal } from "@/lib/services/outside-meals";
import { listTokenMembers } from "@/lib/services/integration-tokens";
import {
  logOutsideMealSchema,
  noActingMember,
  outsideMealDetailJson,
  outsideMealErrorResponse,
  toOutsideMealInput,
} from "@/lib/integration-outside-meals";
import { estimateInBackground } from "@/app/api/v1/outside-meals/estimate-later";

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

// Log a meal out. When the slot already holds an empty "Not cooking" chip
// (kind and place, no dish yet) that one is filled in rather than a second
// added: 200 with action "filled", otherwise 201 with action "created". The
// nutrition estimate follows a few seconds later.
export const POST = withIntegrationAuth("write:outside_meals", async (req: NextRequest, ctx) => {
  if (!ctx.memberId) return noActingMember();
  const session = { householdId: ctx.householdId, memberId: ctx.memberId };

  try {
    const body = logOutsideMealSchema.parse(await req.json());
    const input = toOutsideMealInput(body, await listTokenMembers(ctx.householdId));
    const mealType = body.mealType ?? "dinner";

    const sameDay = await listOutsideMeals(ctx.householdId, { from: body.date, to: body.date });
    const chip = sameDay.find((m) => m.mealType === mealType && !isOutsideMealDescribed(m));

    // A slot marked skipped that turns out to have a meal was eaten out after all.
    const kind = input.kind ?? (chip?.kind === "skipped" ? "eat_out" : undefined);
    const meal = chip
      ? (await updateOutsideMeal(session, chip.id, { ...input, kind, date: undefined, mealType: undefined })).meal
      : await createOutsideMeal(session, { ...input, date: body.date });
    estimateInBackground(session, meal, req);

    return NextResponse.json(
      { action: chip ? "filled" : "created", meal: outsideMealDetailJson(meal, publicOrigin(req.headers)) },
      { status: chip ? 200 : 201 }
    );
  } catch (err) {
    const res = outsideMealErrorResponse(err);
    if (res) return res;
    throw err;
  }
});
