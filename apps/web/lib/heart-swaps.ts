/**
 * Heart-healthy swap suggestions for shopping list items.
 *
 * A fixed keyword table rather than an AI call: the list renders on every open,
 * offline too, and the useful swaps are a short, well-known set. Each rule names
 * the ingredient it fires on and the ones it must NOT fire on — "butter" is not
 * "peanut butter", "cream" is not "ice cream", "mince" is not "turkey mince".
 *
 * Only shown when someone in the household has the Cholesterol-lowering dietary
 * toggle (see lib/heart-healthy.ts).
 */

export type HeartSwap = {
  /** What to buy instead. */
  swap: string;
  /** One line on why, for the tooltip. */
  why: string;
};

type Rule = HeartSwap & { match: RegExp; unless?: RegExp };

// Already the lighter version — never suggest a swap for these.
// ("5%" is matched separately: \b doesn't sit between "%" and a space.)
const ALREADY_LIGHT = /\b(light|lighter|half[- ]fat|reduced[- ]fat|low[- ]fat|fat[- ]free|lean|extra[- ]lean|skimmed|semi[- ]skimmed|wholemeal|wholewheat|whole[- ]wheat|brown|plant[- ]based|vegan|veggie|vegetarian)\b|(^|\s)\d+(\.\d+)?%/i;

const RULES: Rule[] = [
  {
    match: /\bbutter\b/i,
    unless: /peanut|almond|cashew|nut butter|butter ?beans?|buttermilk|butternut|cocoa butter|apple butter/i,
    swap: "olive oil, or a plant-sterol spread",
    why: "Butter is one of the biggest sources of saturated fat.",
  },
  {
    match: /\b(ghee|lard|suet|dripping|goose fat|duck fat)\b/i,
    swap: "rapeseed or olive oil",
    why: "Animal cooking fats are mostly saturated fat.",
  },
  {
    match: /\bcoconut (oil|cream)\b|\bcreamed coconut\b/i,
    swap: "rapeseed oil, or light coconut milk for sauces",
    why: "Coconut oil and cream are higher in saturated fat than butter.",
  },
  {
    match: /\bcoconut milk\b/i,
    swap: "light coconut milk",
    why: "About a third of the saturated fat of full-fat coconut milk.",
  },
  {
    match: /\bcream cheese\b|\bmascarpone\b/i,
    swap: "light cream cheese or quark",
    why: "Full-fat soft cheeses are very high in saturated fat.",
  },
  {
    match: /\bcr[eè]me fra[iî]che\b|\bsour(ed)? cream\b/i,
    swap: "half-fat crème fraîche or Greek yoghurt",
    why: "Same tang with far less saturated fat.",
  },
  {
    match: /\b(double|single|whipping|clotted|heavy)? ?cream\b/i,
    unless: /ice cream|cream cheese|cream crackers?|salad cream|cream of tartar/i,
    swap: "Greek yoghurt, half-fat crème fraîche or evaporated milk",
    why: "Cream is mostly saturated fat.",
  },
  {
    // Parmesan is left alone: it's used a spoonful at a time.
    match: /\b(cheddar|gruy[eè]re|halloumi|brie|camembert|stilton|red leicester|mozzarella|grated cheese|cheese)\b/i,
    unless: /cottage|quark|cream cheese|parmesan|parmigiano|pecorino/i,
    swap: "reduced-fat cheese, or a smaller amount of a strong one",
    why: "Hard cheese is a major source of saturated fat.",
  },
  {
    match: /\b(whole|full[- ]fat) milk\b/i,
    swap: "semi-skimmed or skimmed milk",
    why: "Less saturated fat, same calcium.",
  },
  {
    match: /\b(whole ?milk|full[- ]fat|greek[- ]style)? ?yog(h)?urt\b/i,
    swap: "0% or low-fat Greek yoghurt",
    why: "Thick and creamy without the saturated fat.",
  },
  {
    match: /\b(beef|lamb|pork)? ?mince(d (beef|lamb|pork))?\b/i,
    unless: /turkey|chicken|quorn|soy|vegetable|mincemeat|minced (garlic|ginger|onion)/i,
    swap: "5% lean mince, or swap half for green lentils",
    why: "Standard mince can be 20% fat; lentils add fibre too.",
  },
  {
    match: /\b(bacon|pancetta|lardons?)\b/i,
    swap: "a little smoked paprika, or trimmed back bacon",
    why: "Processed meat — worth cutting down on a cholesterol-lowering diet.",
  },
  {
    match: /\b(chorizo|salami|pepperoni|nduja|'nduja)\b/i,
    swap: "smoked paprika with chickpeas or butter beans",
    why: "Cured sausages are high in saturated fat and salt.",
  },
  {
    match: /\bsausages?\b/i,
    unless: /chicken|turkey|vegetarian|veggie|vegan|quorn|bean/i,
    swap: "chicken, turkey or bean sausages",
    why: "Pork sausages are high in saturated fat and are processed meat.",
  },
  {
    match: /\b(puff|shortcrust) pastry\b/i,
    swap: "filo pastry brushed with olive oil",
    why: "Puff and shortcrust are made with a lot of butter or lard.",
  },
  {
    match: /\bwhite (rice|bread|pasta)\b|\b(spaghetti|penne|fusilli|tagliatelle|linguine|pasta)\b/i,
    unless: /rice noodles|pasta sauce/i,
    swap: "the wholewheat / brown version",
    why: "More fibre, which helps lower cholesterol.",
  },
  {
    match: /\b(basmati|long[- ]grain|jasmine|arborio|risotto)? ?rice\b/i,
    unless: /rice (noodles|vinegar|wine|paper|flour|milk)|wild rice|cauliflower rice/i,
    swap: "brown rice, or mix in pearl barley",
    why: "More fibre; barley's soluble fibre helps lower cholesterol.",
  },
];

/** The swap to suggest for a shopping list item, or null when it's fine as it is. */
export function heartSwapFor(ingredientName: string): HeartSwap | null {
  const name = ingredientName.trim();
  if (!name || ALREADY_LIGHT.test(name)) return null;
  for (const rule of RULES) {
    if (rule.match.test(name) && !(rule.unless?.test(name) ?? false)) {
      return { swap: rule.swap, why: rule.why };
    }
  }
  return null;
}
