import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { publicOrigin } from "@/lib/public-origin";
import { getOutsideMeal, updateOutsideMeal } from "@/lib/services/outside-meals";
import { listTokenMembers } from "@/lib/services/integration-tokens";
import {
  editOutsideMealSchema,
  noActingMember,
  outsideMealDetailJson,
  outsideMealErrorResponse,
  toOutsideMealInput,
} from "@/lib/integration-outside-meals";
import { estimateInBackground } from "@/app/api/v1/outside-meals/estimate-later";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: "Meal not found" }, { status: 404 });

// One meal out — e.g. to see its nutrition once the estimate has arrived.
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return withIntegrationAuth("read:meal_plan", async (req, ctx) => {
    if (!UUID_RE.test(id)) return notFound();
    try {
      const meal = await getOutsideMeal(ctx, id);
      return NextResponse.json(outsideMealDetailJson(meal, publicOrigin(req.headers)));
    } catch (err) {
      const res = outsideMealErrorResponse(err);
      if (res) return res;
      throw err;
    }
  })(req);
}

// Partial update: rate it afterwards, add courses, fix the place. Changing
// what was eaten re-estimates the nutrition in the background.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return withIntegrationAuth("write:outside_meals", async (req, ctx) => {
    if (!ctx.memberId) return noActingMember();
    if (!UUID_RE.test(id)) return notFound();
    const session = { householdId: ctx.householdId, memberId: ctx.memberId };

    try {
      const body = editOutsideMealSchema.parse(await req.json());
      const input = toOutsideMealInput(body, await listTokenMembers(ctx.householdId));
      const { meal, staleEstimate } = await updateOutsideMeal(session, id, input);
      if (staleEstimate) estimateInBackground(session, meal, req);
      return NextResponse.json(outsideMealDetailJson(meal, publicOrigin(req.headers)));
    } catch (err) {
      const res = outsideMealErrorResponse(err);
      if (res) return res;
      throw err;
    }
  })(req);
}
