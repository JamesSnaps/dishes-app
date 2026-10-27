/**
 * Nutrition for a meal eaten out — one portion, as served — from whatever the
 * eater gave: their own words, the dish's line from the menu, a photo of the
 * menu, a photo of the plate.
 *
 * A sibling of the recipe estimator in `app/actions/ai.ts`, not a reuse of it:
 * that one divides a recipe's ingredient amounts by its servings, and here
 * there are no amounts — only a description of a plate. The output is the
 * same eight numbers, so everything downstream reads both alike.
 *
 * The menu is the best clue to what's in the dish; the plate photo to how big
 * it was and what actually came. A calorie figure printed on the menu (larger
 * chains in England must show one) is taken as given: the model's other
 * numbers are scaled to it (`anchorToMenuKcal`).
 */

import type OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { OutsideMealKind, OutsideMealPortion } from "@dishes/shared";
import { maxTokensParam, type RecipeNutrition } from "@/lib/ai/recipe-generation";

export type OutsideMealBrief = {
  kind: OutsideMealKind;
  title: string | null;
  place: string | null;
  cuisine: string | null;
  description: string | null;
  menuText: string | null;
  portion: OutsideMealPortion;
  menuKcal: number | null;
  /** `data:` URLs, already shrunk. */
  platePhoto: string | null;
  menuPhoto: string | null;
};

export type OutsideMealReading = {
  title: string | null;
  cuisine: string | null;
  components: string[];
  mainIngredients: string[];
  nutrition: RecipeNutrition;
};

const readingSchema = z.object({
  title: z.string().nullable(),
  cuisine: z.string().nullable(),
  components: z.array(z.string()),
  mainIngredients: z.array(z.string()),
  nutrition: z.object({
    calories: z.number(),
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number(),
    saturatedFatG: z.number(),
    fiberG: z.number(),
    sugarG: z.number(),
    sodiumMg: z.number(),
  }),
});

const KIND_WORDS: Record<OutsideMealKind, string> = {
  eat_out: "eaten at a restaurant, pub or café",
  takeaway: "a takeaway or delivery",
  at_friends: "cooked by friends or family at their home",
  skipped: "skipped",
};

const PORTION_WORDS: Record<OutsideMealPortion, string> = {
  lighter: "smaller or lighter than a usual portion of this dish",
  typical: "a usual portion of this dish",
  indulgent: "a large or rich portion — more than usual, or with extras",
};

const SYSTEM_PROMPT = `You estimate the nutrition of one meal someone ate but didn't cook from a recipe: a restaurant plate, a takeaway, a meal at a friend's house.

Work out what was on the plate, then estimate the nutrition of ONE portion as eaten.
- Restaurant and takeaway food usually carries more fat, butter, oil and salt than the same dish cooked at home — account for it. A friend's home cooking is closer to ordinary home cooking.
- The menu text, when given, is the best guide to what the dish contains. The plate photo, when given, is the best guide to the portion size and what actually came (sides, sauces, bread).
- A calories figure printed on the menu, when given, is correct for the dish as listed: make your estimate consistent with it.
- Use standard food composition data. Never return null numbers; give your best realistic estimate.

Return JSON:
- "title": a short name for what was eaten, e.g. "Ribeye steak & chips" (null only if you can't tell at all)
- "cuisine": e.g. "British", "Thai", "Italian" (null if unclear)
- "components": the parts of the plate, e.g. ["8oz ribeye steak", "triple-cooked chips", "peppercorn sauce", "side salad"]
- "mainIngredients": the main foods by plain name, the way they'd appear in a recipe's ingredient list — "beef ribeye steak", "salmon fillet", "chickpeas", "pork sausages", "paneer". Name the meat or fish species. Leave out sauces, oils and seasonings.
- "nutrition": calories (kcal), proteinG, carbsG, fatG, saturatedFatG, fiberG, sugarG (grams) and sodiumMg (milligrams), for the whole portion eaten.`;

function userText(b: OutsideMealBrief): string {
  const lines = [`What it was: ${KIND_WORDS[b.kind]}.`];
  if (b.title) lines.push(`Called: ${b.title}`);
  if (b.place) lines.push(`Where: ${b.place}`);
  if (b.cuisine) lines.push(`Cuisine: ${b.cuisine}`);
  if (b.description) lines.push(`In their words: ${b.description}`);
  if (b.menuText) lines.push(`From the menu:\n${b.menuText}`);
  if (b.menuKcal) lines.push(`Calories printed on the menu: ${b.menuKcal} kcal`);
  lines.push(`Portion: ${PORTION_WORDS[b.portion]}.`);
  if (b.menuPhoto) lines.push("The first photo is the menu.");
  if (b.platePhoto) lines.push(`${b.menuPhoto ? "The second" : "The"} photo is the plate as served.`);
  return lines.join("\n");
}

/** One AI call. Throws when the model's answer can't be used. */
export async function readOutsideMeal(
  client: OpenAI,
  model: string,
  brief: OutsideMealBrief
): Promise<OutsideMealReading> {
  const content: OpenAI.ChatCompletionContentPart[] = [];
  for (const url of [brief.menuPhoto, brief.platePhoto]) {
    if (url) content.push({ type: "image_url", image_url: { url, detail: "high" } });
  }
  content.push({ type: "text", text: userText(brief) });

  const completion = await client.chat.completions.create({
    model,
    response_format: zodResponseFormat(readingSchema, "outside_meal"),
    ...maxTokensParam(model, 800),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("The AI returned nothing.");
  const parsed = readingSchema.parse(JSON.parse(raw));
  const clean = (list: string[]) => list.map((s) => s.trim()).filter(Boolean).slice(0, 12);

  return {
    title: parsed.title?.trim() || null,
    cuisine: parsed.cuisine?.trim() || null,
    components: clean(parsed.components),
    mainIngredients: clean(parsed.mainIngredients),
    nutrition: anchorToMenuKcal(parsed.nutrition, brief.menuKcal),
  };
}

/**
 * The menu's calorie figure wins. Every other number is scaled by the same
 * factor — a plate the model thought was 900 kcal but the menu says is 1200
 * has more of everything, not just more energy. Negative or non-finite values
 * from the model become null rather than nonsense.
 */
export function anchorToMenuKcal(n: RecipeNutrition, menuKcal: number | null): RecipeNutrition {
  const sane = (v: number | null) => (v != null && Number.isFinite(v) && v >= 0 ? v : null);
  const out: RecipeNutrition = {
    calories: sane(n.calories),
    proteinG: sane(n.proteinG),
    carbsG: sane(n.carbsG),
    fatG: sane(n.fatG),
    saturatedFatG: sane(n.saturatedFatG),
    fiberG: sane(n.fiberG),
    sugarG: sane(n.sugarG),
    sodiumMg: sane(n.sodiumMg),
  };
  const round = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

  if (menuKcal && menuKcal > 0 && out.calories && out.calories > 0) {
    const factor = menuKcal / out.calories;
    return {
      calories: menuKcal,
      proteinG: round(out.proteinG == null ? null : out.proteinG * factor),
      carbsG: round(out.carbsG == null ? null : out.carbsG * factor),
      fatG: round(out.fatG == null ? null : out.fatG * factor),
      saturatedFatG: round(out.saturatedFatG == null ? null : out.saturatedFatG * factor),
      fiberG: round(out.fiberG == null ? null : out.fiberG * factor),
      sugarG: round(out.sugarG == null ? null : out.sugarG * factor),
      sodiumMg: round(out.sodiumMg == null ? null : out.sodiumMg * factor),
    };
  }
  return {
    calories: out.calories == null ? null : Math.round(out.calories),
    proteinG: round(out.proteinG),
    carbsG: round(out.carbsG),
    fatG: round(out.fatG),
    saturatedFatG: round(out.saturatedFatG),
    fiberG: round(out.fiberG),
    sugarG: round(out.sugarG),
    sodiumMg: round(out.sodiumMg),
  };
}
