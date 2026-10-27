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
export function estimateInBackground(ctx: HouseholdContext, meal: OutsideMealView): void {
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
