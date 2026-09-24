/**
 * Pure summaries of "what we ate": heart-healthy share, average saturated fat
 * and fibre, and which proteins turned up — shared by the Stats page and the
 * meal planner's weekly card, so both count the same way.
 *
 * No React, no database: callers hand in `MealFacts`, one per meal eaten.
 */

import { isHeartHealthy } from "./heart-healthy";

export type MealFacts = {
  recipeId: string;
  calories: number | null;
  saturatedFatG: number | string | null;
  fiberG: number | string | null;
  ingredientNames: string[];
};

export const PROTEIN_KINDS = [
  "oilyFish",
  "otherFish",
  "poultry",
  "pulses",
  "redMeat",
  "processedMeat",
] as const;

export type ProteinKind = (typeof PROTEIN_KINDS)[number];

export const PROTEIN_LABELS: Record<ProteinKind, string> = {
  oilyFish: "Oily fish",
  otherFish: "Other fish & seafood",
  poultry: "Poultry",
  pulses: "Beans, lentils & tofu",
  redMeat: "Red meat",
  processedMeat: "Processed meat",
};

/**
 * Weekly targets for a cholesterol-lowering diet — the same rules the planner's
 * "Heart-healthy week" asks the AI for. `min` is at least, `max` at most.
 */
export const WEEKLY_PROTEIN_TARGETS: Partial<Record<ProteinKind, { min?: number; max?: number }>> = {
  oilyFish: { min: 2 },
  pulses: { min: 3 },
  redMeat: { max: 1 },
  processedMeat: { max: 0 },
};

// Flavourings that name an animal without being a serving of it.
const NOT_A_PROTEIN = /\b(stock|broth|bouillon|gravy|sauce|paste|seasoning|flavou?r|extract|cube|granules|powder|dripping)\b|\b(duck|goose|beef|pork|chicken) fat\b/i;

const PROTEIN_PATTERNS: [ProteinKind, RegExp, RegExp?][] = [
  // Processed first: "pork sausages" is processed meat, not also red meat.
  [
    "processedMeat",
    /\b(bacon|pancetta|lardons?|chorizo|salami|pepperoni|ham|prosciutto|parma ham|serrano|sausages?|hot ?dogs?|frankfurters?|n?'?nduja|corned beef|pastrami|black pudding)\b/i,
    /\b(chicken|turkey|vegetarian|veggie|vegan|quorn|bean) sausages?\b/i,
  ],
  ["oilyFish", /\b(salmon|mackerel|sardines?|trout|herrings?|kippers?|pilchards?)\b/i],
  [
    "otherFish",
    /\b(cod|haddock|pollock|pollack|hake|sea ?bass|plaice|sole|tilapia|basa|tuna|prawns?|shrimps?|scallops?|mussels|clams|squid|calamari|crab|lobster|monkfish|white fish|fish fillets?)\b/i,
  ],
  ["poultry", /\b(chicken|turkey|duck|poussin|guinea fowl)\b/i],
  [
    "pulses",
    /\b(lentils?|dh?al|chickpeas?|garbanzo|split peas|tofu|tempeh|edamame|hummus|houmous|(black|kidney|cannellini|butter|haricot|borlotti|pinto|broad|flageolet|mung|aduki|adzuki|baked|refried|white) beans?)\b/i,
  ],
  [
    "redMeat",
    /\b(beef|steak|lamb|mutton|pork|veal|venison|goat|brisket|oxtail|mince)\b/i,
    /\b(turkey|chicken|quorn|soy|vegetable) mince\b|mincemeat/i,
  ],
];

/** Which kinds of protein a recipe contains, judged from its ingredient names. */
export function proteinsOf(ingredientNames: string[]): Set<ProteinKind> {
  const found = new Set<ProteinKind>();
  for (const raw of ingredientNames) {
    const name = raw.trim();
    if (!name || NOT_A_PROTEIN.test(name)) continue;
    for (const [kind, match, unless] of PROTEIN_PATTERNS) {
      if (match.test(name) && !(unless?.test(name) ?? false)) {
        found.add(kind);
        // One ingredient is one kind — "pork sausages" stops at processed.
        break;
      }
    }
  }
  return found;
}

function toNumber(v: number | string | null): number | null {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export type MealSummary = {
  meals: number;
  /** Meals with both saturated fat and fibre figures — the heart-healthy denominator. */
  withNutrition: number;
  heartHealthy: number;
  avgSaturatedFatG: number | null;
  avgFiberG: number | null;
  avgCalories: number | null;
  /** Meals containing each kind (a meal can count towards several). */
  proteins: Record<ProteinKind, number>;
};

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export function summariseMeals(meals: MealFacts[]): MealSummary {
  const satFat: number[] = [];
  const fiber: number[] = [];
  const calories: number[] = [];
  const proteins = Object.fromEntries(PROTEIN_KINDS.map((k) => [k, 0])) as Record<ProteinKind, number>;
  let withNutrition = 0;
  let heartHealthy = 0;

  for (const meal of meals) {
    const s = toNumber(meal.saturatedFatG);
    const f = toNumber(meal.fiberG);
    if (s !== null) satFat.push(s);
    if (f !== null) fiber.push(f);
    if (meal.calories !== null) calories.push(meal.calories);
    if (s !== null && f !== null) {
      withNutrition++;
      if (isHeartHealthy(meal)) heartHealthy++;
    }
    for (const kind of proteinsOf(meal.ingredientNames)) proteins[kind]++;
  }

  return {
    meals: meals.length,
    withNutrition,
    heartHealthy,
    avgSaturatedFatG: mean(satFat),
    avgFiberG: mean(fiber),
    avgCalories: calories.length ? Math.round(mean(calories)!) : null,
    proteins,
  };
}

/** Whether a weekly count meets its target; undefined when the kind has none. */
export function meetsTarget(kind: ProteinKind, perWeek: number): boolean | undefined {
  const t = WEEKLY_PROTEIN_TARGETS[kind];
  if (!t) return undefined;
  if (t.min !== undefined && perWeek < t.min) return false;
  if (t.max !== undefined && perWeek > t.max) return false;
  return true;
}
