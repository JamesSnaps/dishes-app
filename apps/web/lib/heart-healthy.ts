/**
 * "Heart-healthy" — a recipe that suits a cholesterol-lowering diet, judged from
 * its per-serving nutrition rather than a hand-applied tag.
 *
 * Two things move LDL cholesterol through diet: saturated fat (lower is better)
 * and soluble fibre (higher is better). Total fat is deliberately not a
 * criterion — olive oil, nuts and oily fish are high in fat and good for this.
 *
 * A recipe with either number missing is not heart-healthy: unknown is not the
 * same as low. Settings → Maintenance can estimate saturated fat for older
 * recipes that predate the column.
 *
 * Shared by the SQL filter (recipes page, /api/v1/recipes), the on-device
 * filter and the card badge, so all three agree.
 */

/** Grams of saturated fat per serving, at most. */
export const HEART_HEALTHY_MAX_SATURATED_FAT_G = 4;
/** Grams of fibre per serving, at least. */
export const HEART_HEALTHY_MIN_FIBER_G = 3;

type Numeric = number | string | null | undefined;

function toNumber(v: Numeric): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function isHeartHealthy(r: { saturatedFatG?: Numeric; fiberG?: Numeric }): boolean {
  const satFat = toNumber(r.saturatedFatG);
  const fiber = toNumber(r.fiberG);
  return (
    satFat !== null &&
    fiber !== null &&
    satFat <= HEART_HEALTHY_MAX_SATURATED_FAT_G &&
    fiber >= HEART_HEALTHY_MIN_FIBER_G
  );
}

/** The member dietary toggle for this diet (Settings → Members). */
export const CHOLESTEROL_DIETARY_FLAG = "Cholesterol-lowering";

/**
 * Whether a member's dietary notes say they're on a cholesterol-lowering diet.
 * Used only to pre-select the heart-healthy option when that person is ticked
 * as eating — a convenience, never a restriction, so a loose match is fine.
 * The dietary toggle is the intended route; free-text notes that mention it
 * (entered before the toggle existed) still count.
 */
export function mentionsCholesterolDiet(texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && /cholesterol|heart[- ]?healthy|statin|\bldl\b/i.test(t));
}
