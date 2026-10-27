import { after } from "next/server";
import { createLogger } from "@/lib/logger";
import type { HouseholdContext } from "@/lib/session";
import type { OutsideMealView } from "@/lib/outside-meals";
import { estimateOutsideMealNutrition } from "@/lib/services/outside-meals";

const log = createLogger("outside-meals");

/**
 * Estimate a meal's nutrition after the response has gone — the native app
 * gets the figures by sync. Skipped when there's nothing to estimate from, or
 * the figures were typed in. No key, no estimate (logged, not an error).
 */
export function estimateInBackground(ctx: HouseholdContext, meal: OutsideMealView, req?: Request): void {
  // `?estimate=false`: the client will ask for the estimate itself (POST
  // …/estimate) once its photos are up — one AI call, with everything, rather
  // than one per step racing each other.
  if (req && new URL(req.url).searchParams.get("estimate") === "false") return;
  if (meal.nutritionSource === "manual" || meal.kind === "skipped") return;
  if (!meal.title && !meal.description && !meal.menuText && !meal.photoUrl && !meal.menuPhotoUrl) return;
  const scope = { householdId: ctx.householdId, memberId: ctx.memberId };
  after(async () => {
    try {
      await estimateOutsideMealNutrition(scope, meal.id);
    } catch (err) {
      log.info(`no nutrition for ${meal.id}: ${err instanceof Error ? err.message : err}`);
    }
  });
}
