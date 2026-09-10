/**
 * The shared machinery for turning a recipe concept into a complete, structured
 * recipe: the response schema, the prompt fragments, and the call itself.
 *
 * This lives outside `app/actions/ai.ts` because that file is a `"use server"`
 * module — it may only export async functions, so schemas, prompt fragments and
 * sync helpers cannot be shared from it. The integrations API needs exactly the
 * same generation the concierge uses, so it lives here and both import it.
 */

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";

// --- Types ------------------------------------------------------------------

// Per-serving nutrition. All values are estimates when produced by the AI.
export type RecipeNutrition = {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
};

export type ConceptCard = {
  title: string;
  description: string;
  cuisine: string;
  tags: string[];
  difficulty: "easy" | "medium" | "hard";
};

export type GeneratedRecipe = {
  title: string;
  description: string;
  cuisine: string;
  difficulty: "easy" | "medium" | "hard";
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: string;
  servingsUnit: string;
  mealTypes: string[];
  tags: string[];
  ingredients: Array<{
    ingredientName: string;
    amount: string;
    unit: string;
    preparation: string;
    isOptional: boolean;
    groupLabel: string;
  }>;
  steps: Array<{
    instruction: string;
    durationMinutes: string;
    timerLabel: string;
    groupLabel: string;
  }>;
  notes: string | null;
  nutrition?: RecipeNutrition | null;
};

export const generatedRecipeSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  cuisine: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  prepTimeMinutes: z.number().int().nonnegative().nullable(),
  cookTimeMinutes: z.number().int().nonnegative().nullable(),
  servings: z.string().min(1),
  servingsUnit: z.string().min(1),
  mealTypes: z.array(z.enum(["breakfast", "lunch", "dinner", "dessert", "snack"])),
  tags: z.array(z.string()),
  ingredients: z
    .array(
      z
        .object({
          ingredientName: z.string().min(1),
          amount: z.string(),
          unit: z.string(),
          preparation: z.string(),
          isOptional: z.boolean(),
          groupLabel: z.string(),
        })
        .strict()
    )
    .min(1),
  steps: z
    .array(
      z
        .object({
          instruction: z.string().min(1),
          durationMinutes: z.string(),
          timerLabel: z.string(),
          groupLabel: z.string(),
        })
        .strict()
    )
    .min(1),
  notes: z.string().nullable(),
  nutrition: z
    .object({
      calories: z.number().nonnegative(),
      proteinG: z.number().nonnegative(),
      carbsG: z.number().nonnegative(),
      fatG: z.number().nonnegative(),
      fiberG: z.number().nonnegative(),
      sugarG: z.number().nonnegative(),
      sodiumMg: z.number().nonnegative(),
    })
    .strict(),
}).strict();

// --- Prompt fragments -------------------------------------------------------

// Shared prompt fragment for the meal-types array. Drives meal-plan slot
// matching, so the model must be honest about which meals a dish actually suits.
export const MEAL_TYPES_SCHEMA_FRAGMENT = `  "mealTypes": string[] (which meals this dish genuinely suits — any of "breakfast","lunch","dinner","dessert","snack". Be realistic: a rich curry or roast is ["dinner"] (maybe "lunch"), eggs/pancakes/porridge are ["breakfast"], a light salad bowl is ["lunch","dinner"] but NOT "breakfast". Never include a meal a normal person wouldn't eat this dish for.)`;

// Shared prompt fragment describing the nutrition object the model must return.
export const NUTRITION_SCHEMA_FRAGMENT = `  "nutrition": {
    "calories": number (kcal per serving),
    "proteinG": number, "carbsG": number, "fatG": number,
    "fiberG": number, "sugarG": number, "sodiumMg": number
  } (best-effort per-serving estimate based on the ingredients and servings; use realistic values, never null)`;

/** Household AI settings folded into a system prompt suffix. */
export function buildSystemAddendum(
  defaultPrompt: string | null,
  measurementSystem: string,
  kitchenEquipment: string | null
): string {
  const parts: string[] = [];
  if (measurementSystem === "metric") {
    parts.push(
      "Always use metric measurements only: grams (g), millilitres (ml), kilograms (kg), litres (l). Never use cups, tablespoons, teaspoons, fluid ounces, pounds, or any other imperial or US customary units."
    );
  }
  if (defaultPrompt?.trim()) {
    parts.push(defaultPrompt.trim());
  }
  if (kitchenEquipment?.trim()) {
    parts.push(`Available kitchen equipment: ${kitchenEquipment.trim()}. Size recipes to fit this equipment where relevant.`);
  }
  return parts.length ? `\n\nAdditional requirements: ${parts.join(" ")}` : "";
}

/** The system prompt that turns a concept into a complete recipe. */
export function fullRecipeSystemPrompt(addendum: string): string {
  return `You are a chef writing detailed, family-friendly recipes. Return a complete recipe as JSON matching this exact schema:
{
  "title": string,
  "description": string (2-3 sentences),
  "cuisine": string,
  "difficulty": "easy"|"medium"|"hard",
  "prepTimeMinutes": number|null,
  "cookTimeMinutes": number|null,
  "servings": string (e.g. "4"),
  "servingsUnit": string (e.g. "servings"),
  "tags": string[],
  "ingredients": [
    {"ingredientName": string, "amount": string, "unit": string, "preparation": string (empty string if no preparation needed — never use "none"), "isOptional": boolean, "groupLabel": string}
  ],
  "steps": [
    {"instruction": string, "durationMinutes": string (empty string if no timer), "timerLabel": string (empty string if no timer), "groupLabel": string}
  ],
  "notes": string|null,
${MEAL_TYPES_SCHEMA_FRAGMENT},
${NUTRITION_SCHEMA_FRAGMENT}
}
Use realistic quantities and clear step-by-step instructions. Use groupLabel on both ingredients and steps to group the related parts of a recipe that has genuinely distinct components or sub-recipes (e.g. "Granola" vs "Smoothie", or "Sauce", "Marinade") — use the SAME label for an ingredient group and its matching step group. For a simple single-component recipe leave every groupLabel as an empty string.${addendum}`;
}

/** The user turn that names the concept to write up. */
export function fullRecipeUserPrompt(
  concept: ConceptCard,
  mealType?: string,
  targetCalories?: number
): string {
  return `Generate a full recipe for: "${concept.title}"\nDescription: ${concept.description}\nCuisine: ${concept.cuisine}\nDifficulty: ${concept.difficulty}${mealType ? `\nMeal type: This must be a ${mealType} recipe — ensure portion size, richness, and style are appropriate for ${mealType}.` : ""}${targetCalories && targetCalories > 0 ? `\nCalorie target: aim for roughly ${targetCalories} kcal per serving — adjust quantities and ingredient choices to land near this.` : ""}`;
}

// --- The call ---------------------------------------------------------------

// gpt-4.1-x, gpt-5.x, and o-series models use max_completion_tokens; everything else uses max_tokens
export function maxTokensParam(
  model: string,
  tokens: number
): { max_tokens?: number; max_completion_tokens?: number } {
  return /^gpt-5/i.test(model)
    ? { max_completion_tokens: tokens }
    : { max_tokens: tokens };
}

export async function createStructuredRecipe(
  client: OpenAI,
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[]
): Promise<GeneratedRecipe> {
  // A detailed recipe can exceed the old 2,500-token ceiling. Start with enough
  // room for a complete response, then retry once if the model still hits it.
  for (const tokenBudget of [6000, 10000]) {
    const completion = await client.chat.completions.create({
      model,
      response_format: zodResponseFormat(generatedRecipeSchema, "generated_recipe"),
      ...maxTokensParam(model, tokenBudget),
      messages,
    });

    const choice = completion.choices[0];
    if (choice?.finish_reason === "length") continue;
    if (choice?.finish_reason === "content_filter")
      throw new Error("The AI response was blocked by its content filter.");

    const raw = choice?.message?.content;
    if (!raw) throw new Error("The AI returned an empty recipe response.");

    return generatedRecipeSchema.parse(JSON.parse(raw));
  }

  throw new Error("The recipe response was cut off after reaching the maximum output length.");
}
