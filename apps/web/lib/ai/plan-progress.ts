// What the week planner tells the person waiting on it. Every line is a fact
// from the household's own data or what they asked for — never a made-up
// "thinking" line — so the wait screen can say it plainly.

/** What the planner knows once the library is narrowed, before it asks the AI. */
export type PlanFactsInput = {
  /** Recipes read from the library (mains, after any cuisine or tag filter). */
  scanned: number;
  /** Of those, how many it can choose from. */
  eligible: number;
  favouritesOnly: boolean;
  /** Held back because they were planned or cooked lately. */
  resting: number;
  /** The cooldown those were held back by, in weeks (relaxed on a small library). */
  restingWeeks: number;
  /** Left out because someone eating, or the household, rated them 2★ or less. */
  disliked: number;
  eaters: string[];
  heartHealthy: boolean;
  /** Meals already in the week being planned. */
  alreadyPlanned: number;
  /** Day names (Monday…) the household isn't cooking: eating out, takeaway, skipped. */
  notCookingDays: string[];
  /** A partial redo: how many of the draft's meals are staying. */
  keeping: number;
  /** The month of the week being planned, for seasonality; null when unknown. */
  month: string | null;
  /** The slots being planned, by meal type. */
  mealTypes: string[];
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Sam", "Sam and Alex", "Sam, Alex and Jo". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "dinners", "lunches"; mixed slots are "meals". */
export function mealsPhrase(mealTypes: string[]): string {
  const kinds = [...new Set(mealTypes)];
  if (kinds.length !== 1) return mealTypes.length === 1 ? "meal" : "meals";
  const kind = kinds[0]!;
  if (mealTypes.length === 1) return kind;
  return /(ch|sh|s|x)$/.test(kind) ? `${kind}es` : `${kind}s`;
}

export function planFacts(f: PlanFactsInput): string[] {
  const facts: string[] = [];
  if (f.scanned > 0) facts.push(f.scanned === 1 ? "Looking through your one recipe" : `Looking through ${f.scanned} of your recipes`);
  if (f.favouritesOnly) facts.push(f.eligible > 0 ? `Choosing from ${count(f.eligible, "favourite")}` : "No favourites to choose from, so all new ideas");
  if (f.resting > 0 && f.restingWeeks > 0) {
    facts.push(`Resting ${count(f.resting, "dish", "dishes")} you’ve had in the last ${f.restingWeeks === 1 ? "week" : `${f.restingWeeks} weeks`}`);
  }
  if (f.disliked > 0) facts.push(`Leaving out ${count(f.disliked, "dish", "dishes")} rated 2★ or less`);
  if (f.eaters.length) facts.push(`Cooking for ${joinNames(f.eaters)}`);
  if (f.heartHealthy) facts.push("Keeping the week heart-healthy");
  if (f.alreadyPlanned > 0) facts.push(`Planning around ${count(f.alreadyPlanned, "meal")} already in the week`);
  if (f.notCookingDays.length) facts.push(`Not cooking on ${joinNames([...new Set(f.notCookingDays)])}`);
  if (f.keeping > 0) facts.push(`Balancing against the ${count(f.keeping, "meal")} you’re keeping`);
  if (f.month) facts.push(`Leaning into ${f.month} produce`);
  facts.push(`Choosing ${f.mealTypes.length} ${mealsPhrase(f.mealTypes)}`);
  return facts;
}

/** How many library photos the wait screen gets to spin through. */
export const PLAN_PHOTO_COUNT = 16;

/**
 * The photos for the wait: recipes it might choose first (they're shuffled
 * already), topped up from the rest of the library when too few have one.
 */
export function planPhotos(
  candidates: { thumbnailUrl: string | null; imageUrl: string | null }[],
  rest: { thumbnailUrl: string | null; imageUrl: string | null }[]
): string[] {
  const out: string[] = [];
  for (const r of [...candidates, ...rest]) {
    const url = r.thumbnailUrl || r.imageUrl;
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= PLAN_PHOTO_COUNT) break;
  }
  return out;
}
