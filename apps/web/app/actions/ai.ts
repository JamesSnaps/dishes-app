"use server";

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { aiConfigurations, recipes, recipeIngredients, mealPlanEntries, mealPlans, cookHistory, recipeTags, householdMembers, tasteProfiles, collections } from "@dishes/db/schema";
import { eq, and, count, max, avg, desc, inArray, isNull, isNotNull } from "drizzle-orm";
import { MEAL_TYPES } from "@dishes/shared";
import { decrypt } from "@/lib/crypto";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { uploadFile, isStorageAvailable, keyFromUrl } from "@/lib/storage";
import { makeThumbnail } from "@/lib/thumbnail";
import { revalidatePath } from "next/cache";
import { getStyleSuffix } from "@/lib/image-styles";

// ── Shared types ───────────────────────────────────────────────────────────────

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

const generatedRecipeSchema = z.object({
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

// Shared prompt fragment for the meal-types array. Drives meal-plan slot
// matching, so the model must be honest about which meals a dish actually suits.
const MEAL_TYPES_SCHEMA_FRAGMENT = `  "mealTypes": string[] (which meals this dish genuinely suits — any of "breakfast","lunch","dinner","dessert","snack". Be realistic: a rich curry or roast is ["dinner"] (maybe "lunch"), eggs/pancakes/porridge are ["breakfast"], a light salad bowl is ["lunch","dinner"] but NOT "breakfast". Never include a meal a normal person wouldn't eat this dish for.)`;

// Shared prompt fragment describing the nutrition object the model must return.
const NUTRITION_SCHEMA_FRAGMENT = `  "nutrition": {
    "calories": number (kcal per serving),
    "proteinG": number, "carbsG": number, "fatG": number,
    "fiberG": number, "sugarG": number, "sodiumMg": number
  } (best-effort per-serving estimate based on the ingredients and servings; use realistic values, never null)`;

// ── Internal helpers ───────────────────────────────────────────────────────────

type AiConfig = {
  client: OpenAI;
  model: string;
  imageModel: string;
  defaultPrompt: string | null;
  kitchenEquipment: string | null;
  measurementSystem: string;
};

async function getOpenAiClient(householdId: string): Promise<AiConfig> {
  const [config] = await db
    .select({
      encryptedApiKey: aiConfigurations.encryptedApiKey,
      model: aiConfigurations.model,
      imageModel: aiConfigurations.imageModel,
      defaultPrompt: aiConfigurations.defaultPrompt,
      kitchenEquipment: aiConfigurations.kitchenEquipment,
      measurementSystem: aiConfigurations.measurementSystem,
    })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);

  if (!config)
    throw new Error("AI not configured. Add your API key in Settings → AI.");

  const apiKey = decrypt(config.encryptedApiKey);
  return {
    // Force native (undici) fetch instead of the SDK's bundled node-fetch.
    // node-fetch's keep-alive handling throws "Premature close" on Node 22.23+,
    // breaking every AI call; native fetch is unaffected.
    client: new OpenAI({ apiKey, fetch: globalThis.fetch }),
    model: config.model,
    imageModel: config.imageModel,
    defaultPrompt: config.defaultPrompt,
    kitchenEquipment: config.kitchenEquipment,
    measurementSystem: config.measurementSystem,
  };
}

// gpt-4.1-x, gpt-5.x, and o-series models use max_completion_tokens; everything else uses max_tokens
function maxTokensParam(model: string, tokens: number): { max_tokens?: number; max_completion_tokens?: number } {
  return /^gpt-5/i.test(model)
    ? { max_completion_tokens: tokens }
    : { max_tokens: tokens };
}

function classifyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Incorrect API key") || msg.includes("invalid_api_key"))
    return "Invalid API key — check Settings → AI.";
  if (msg.includes("429") || msg.includes("quota") || msg.includes("rate limit"))
    return "OpenAI rate limit or quota exceeded. Try again shortly.";
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT"))
    return "Request timed out. Try again.";
  if (
    msg.includes("Unexpected end of JSON input") ||
    msg.includes("Unterminated string in JSON") ||
    msg.includes("recipe response was cut off")
  )
    return "The AI response was cut off before the recipe finished. Please try again.";
  return `AI error: ${msg}`;
}

async function createStructuredRecipe(
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

async function buildMemberConstraints(memberIds: string[], householdId: string): Promise<string> {
  if (!memberIds.length) return "";
  const members = await db
    .select({
      displayName: householdMembers.displayName,
      role: householdMembers.role,
      birthYear: householdMembers.birthYear,
      dietaryFlags: householdMembers.dietaryFlags,
      dislikes: householdMembers.dislikes,
      preferences: householdMembers.preferences,
      customNotes: householdMembers.customNotes,
    })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), inArray(householdMembers.id, memberIds)));

  if (!members.length) return "";

  const currentYear = new Date().getFullYear();
  let hasYoungChild = false;

  const lines = members.map((m) => {
    // Surface age / child status so suggestions can be tailored to who's eating.
    const age = m.birthYear ? currentYear - m.birthYear : null;
    let descriptor = m.displayName;
    if (age !== null) {
      descriptor += ` (age ${age})`;
      if (age <= 8) hasYoungChild = true;
    } else if (m.role === "child") {
      descriptor += " (a child)";
      hasYoungChild = true;
    }
    const parts: string[] = [`${descriptor}:`];
    if (m.dietaryFlags?.length) parts.push(`dietary requirements: ${m.dietaryFlags.join(", ")}`);
    if (m.dislikes?.length) parts.push(`dislikes: ${m.dislikes.join(", ")}`);
    if (m.preferences?.length) parts.push(`loves: ${m.preferences.join(", ")}`);
    if (m.customNotes?.trim()) parts.push(m.customNotes.trim());
    return parts.join(" — ");
  });

  let guidance = `\n\nWho's eating: ${lines.join("; ")}. Please respect all dietary requirements, avoid any listed dislikes, and lean towards their preferences where possible.`;
  if (hasYoungChild) {
    guidance +=
      " One or more diners is a young child, so keep every suggestion genuinely simple, mild and child-friendly with small, age-appropriate portions and easy-to-eat textures. Do not suggest elaborate, rich or restaurant-style dishes, and avoid common choking hazards for very young children.";
  }
  return guidance;
}

function buildSystemAddendum(defaultPrompt: string | null, measurementSystem: string, kitchenEquipment: string | null): string {
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

async function buildTasteProfileAddendum(householdId: string): Promise<string> {
  const [profile] = await db
    .select()
    .from(tasteProfiles)
    .where(eq(tasteProfiles.householdId, householdId))
    .limit(1);

  if (!profile || profile.ratedCookCount < 10) return "";

  const cuisines = profile.cuisines as Record<string, number>;
  const ingredients = profile.ingredients as Record<string, number>;

  const topCuisines = Object.entries(cuisines)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, score]) => `${name} (${score}/5)`);

  const likedIngredients = Object.entries(ingredients)
    .filter(([, s]) => s >= 3.0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name]) => name);

  const dislikedIngredients = Object.entries(ingredients)
    .filter(([, s]) => s <= 1.5)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 5)
    .map(([name]) => name);

  const lines: string[] = [`\n\nHousehold taste profile (from ${profile.ratedCookCount} rated cooks):`];
  if (topCuisines.length) lines.push(`- Preferred cuisines: ${topCuisines.join(", ")}`);
  if (likedIngredients.length) lines.push(`- Loved ingredients: ${likedIngredients.join(", ")}`);
  if (dislikedIngredients.length) lines.push(`- Disliked ingredients: ${dislikedIngredients.join(", ")}`);
  lines.push("Lean towards their preferred cuisines and loved ingredients. Strictly avoid their disliked ingredients.");

  return lines.join("\n");
}

// ── Step 1: Generate 5 concept cards ──────────────────────────────────────────

export async function generateConcepts(
  prompt: string,
  memberIds?: string[],
  mealType?: string,
  targetCalories?: number
): Promise<{ concepts?: ConceptCard[]; error?: string }> {
  if (!prompt.trim())
    return { error: "Please describe what you'd like to cook." };

  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const [{ client, model, defaultPrompt, kitchenEquipment, measurementSystem }, memberConstraints, tasteAddendum] = await Promise.all([
      getOpenAiClient(householdId),
      buildMemberConstraints(memberIds ?? [], householdId),
      buildTasteProfileAddendum(householdId),
    ]);

    const addendum = buildSystemAddendum(defaultPrompt, measurementSystem, kitchenEquipment) + tasteAddendum + memberConstraints;
    const isLightMeal = /breakfast|lunch|snack|brunch/i.test(mealType ?? "");
    const mealTypeInstruction = mealType
      ? `\nIMPORTANT: All 5 concepts must be ${mealType} recipes that are genuinely appropriate for ${mealType}.${
          isLightMeal
            ? ` Keep them light and easy — ${mealType}-sized, not full dinner-style meals.`
            : ""
        }`
      : "";
    const calorieInstruction =
      targetCalories && targetCalories > 0
        ? `\nIMPORTANT: Each concept should be achievable at roughly ${targetCalories} kcal per serving — favour ingredients and portion sizes that fit that calorie target.`
        : "";

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      ...maxTokensParam(model, 1200),
      messages: [
        {
          role: "system",
          content: `You are a helpful chef helping a family choose what to cook. Return exactly 5 distinct recipe concepts as JSON.
Format: {"concepts": [{"title": "...", "description": "1-2 sentences", "cuisine": "...", "tags": ["..."], "difficulty": "easy"|"medium"|"hard"}]}
Make the 5 concepts meaningfully different from each other in style or cuisine, but always match their effort, richness and portion size to what the user actually asked for. If the user asks for something simple, quick, light or for a child, every concept must stay simple — do not pad the list with elaborate or restaurant-style dishes.${mealTypeInstruction}${calorieInstruction}${addendum}`,
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { concepts: ConceptCard[] };
    if (!Array.isArray(parsed.concepts) || parsed.concepts.length === 0)
      throw new Error("Unexpected response format from AI.");

    return { concepts: parsed.concepts.slice(0, 5) };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Generate similar recipe concepts from an existing recipe ──────────────────

export async function generateSimilarConcepts(
  recipeId: string,
  userNote?: string
): Promise<{ concepts?: ConceptCard[]; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);

    const [recipe] = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .limit(1);
    if (!recipe) return { error: "Recipe not found." };

    const [ingredientRows, tagRows, aiConfig, tasteAddendum] = await Promise.all([
      db.select({ ingredientName: recipeIngredients.ingredientName }).from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId)),
      db.select({ tag: recipeTags.tag }).from(recipeTags).where(eq(recipeTags.recipeId, recipeId)),
      getOpenAiClient(householdId),
      buildTasteProfileAddendum(householdId),
    ]);

    const { client, model, defaultPrompt, kitchenEquipment, measurementSystem } = aiConfig;
    const addendum = buildSystemAddendum(defaultPrompt, measurementSystem, kitchenEquipment) + tasteAddendum;

    const sourceLines = [
      `Title: ${recipe.title}`,
      recipe.description ? `Description: ${recipe.description}` : null,
      recipe.cuisine ? `Cuisine: ${recipe.cuisine}` : null,
      recipe.difficulty ? `Difficulty: ${recipe.difficulty}` : null,
      ingredientRows.length ? `Key ingredients: ${ingredientRows.slice(0, 12).map((r) => r.ingredientName).join(", ")}` : null,
      tagRows.length ? `Tags: ${tagRows.map((r) => r.tag).join(", ")}` : null,
    ].filter(Boolean).join("\n");

    const userContext = userNote?.trim() ? `\n\nSpecific request from the user: ${userNote.trim()}` : "";

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      ...maxTokensParam(model, 1200),
      messages: [
        {
          role: "system",
          content: `You are a creative chef helping a family discover new recipes inspired by one they already love. Return exactly 5 distinct recipe concepts as JSON.
Format: {"concepts": [{"title": "...", "description": "1-2 sentences", "cuisine": "...", "tags": ["..."], "difficulty": "easy"|"medium"|"hard"}]}
Each concept should be inspired by the source recipe — similar flavour profile, complementary techniques, or the same cuisine family — but a clearly different dish. Make the 5 concepts meaningfully different from each other.${addendum}`,
        },
        {
          role: "user",
          content: `Here is the recipe to use as inspiration:\n${sourceLines}${userContext}\n\nGenerate 5 similar recipe concepts.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { concepts: ConceptCard[] };
    if (!Array.isArray(parsed.concepts) || parsed.concepts.length === 0)
      throw new Error("Unexpected response format from AI.");

    return { concepts: parsed.concepts.slice(0, 5) };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Improve an existing recipe ─────────────────────────────────────────────────

export async function improveRecipe(
  current: GeneratedRecipe,
  instruction: string,
  cookContext?: string
): Promise<{ recipe?: GeneratedRecipe; summary?: string; error?: string }> {
  if (!instruction.trim())
    return { error: "Please describe how you'd like to improve the recipe." };

  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const { client, model, defaultPrompt, kitchenEquipment, measurementSystem } = await getOpenAiClient(householdId);

    const addendum = buildSystemAddendum(defaultPrompt, measurementSystem, kitchenEquipment) +
      (cookContext ? `\n\nCook history for this recipe:\n${cookContext}` : "");

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      ...maxTokensParam(model, 3000),
      messages: [
        {
          role: "system",
          content: `You are a chef editing an existing recipe based on a user's request. Return JSON with two top-level keys:
1. "changeSummary": a single sentence (first person, e.g. "I've added sweetcorn…") describing what you changed and why.
2. "recipe": the complete modified recipe matching this exact schema:
{
  "title": string,
  "description": string,
  "cuisine": string,
  "difficulty": "easy"|"medium"|"hard",
  "prepTimeMinutes": number|null,
  "cookTimeMinutes": number|null,
  "servings": string,
  "servingsUnit": string,
  "tags": string[],
  "ingredients": [
    {"ingredientName": string, "amount": string, "unit": string, "preparation": string (empty string if no preparation needed — never use "none"), "isOptional": boolean, "groupLabel": string}
  ],
  "steps": [
    {"instruction": string, "durationMinutes": string, "timerLabel": string, "groupLabel": string (section heading for a multi-component recipe — use the same label as the matching ingredient group; empty string if ungrouped)}
  ],
  "notes": string|null,
${MEAL_TYPES_SCHEMA_FRAGMENT},
${NUTRITION_SCHEMA_FRAGMENT}
}
Only change what is necessary to satisfy the user's request. If your changes affect the ingredients or servings, re-estimate the nutrition values; otherwise keep them. Preserve everything else exactly. Return the full recipe even for fields you did not change.
CRITICAL: When the user asks to add, remove, or change an ingredient, you MUST update the "ingredients" array directly — add a new object, remove the matching object, or edit the existing one. NEVER leave a removed ingredient in the list. NEVER write workaround instructions in steps such as "skip the X", "omit the X", or "ignore the X" — make the actual change to the data instead.${addendum}`,
        },
        {
          role: "user",
          content: `Here is the current recipe:\n${JSON.stringify(current, null, 2)}\n\nUser request: ${instruction}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { recipe?: GeneratedRecipe; changeSummary?: string } & GeneratedRecipe;

    // Support both wrapped ({ recipe, changeSummary }) and legacy flat response shapes
    const recipe: GeneratedRecipe = parsed.recipe ?? (parsed as GeneratedRecipe);
    const summary: string | undefined = parsed.changeSummary ?? undefined;

    if (
      !recipe.title ||
      !Array.isArray(recipe.ingredients) ||
      !Array.isArray(recipe.steps)
    ) {
      throw new Error("Incomplete recipe returned by AI.");
    }

    return { recipe, summary };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Estimate nutrition for an existing recipe ──────────────────────────────────
// On-demand: loads the recipe's ingredients/servings, asks the AI for a
// per-serving estimate, persists it (nutritionSource = "ai"), and revalidates.

export async function estimateNutrition(
  recipeId: string
): Promise<{ nutrition?: RecipeNutrition; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);

    const [recipe] = await db
      .select({
        title: recipes.title,
        servings: recipes.servings,
        servingsUnit: recipes.servingsUnit,
      })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .limit(1);
    if (!recipe) return { error: "Recipe not found." };

    const ingredientRows = await db
      .select({
        ingredientName: recipeIngredients.ingredientName,
        amount: recipeIngredients.amount,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeId));

    if (!ingredientRows.length)
      return { error: "This recipe has no ingredients to estimate from." };

    const { client, model, measurementSystem } = await getOpenAiClient(householdId);

    const ingredientList = ingredientRows
      .map((r) => `- ${[r.amount, r.unit, r.ingredientName].filter(Boolean).join(" ")}`)
      .join("\n");
    const servings = recipe.servings ? `${recipe.servings} ${recipe.servingsUnit ?? "servings"}` : "unknown (assume 4 servings)";

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      ...maxTokensParam(model, 400),
      messages: [
        {
          role: "system",
          content: `You are a nutrition estimator. Given a recipe's ingredients and the number of servings, return a best-effort PER-SERVING nutrition estimate as JSON matching exactly:
{
  "calories": number (kcal per serving),
  "proteinG": number, "carbsG": number, "fatG": number,
  "fiberG": number, "sugarG": number, "sodiumMg": number
}
Base your estimate on standard food composition data. Measurement system: ${measurementSystem}. Return realistic numbers, never null.`,
        },
        {
          role: "user",
          content: `Recipe: ${recipe.title}\nServings: ${servings}\nIngredients:\n${ingredientList}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as Partial<RecipeNutrition>;

    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const nutrition: RecipeNutrition = {
      calories: num(parsed.calories),
      proteinG: num(parsed.proteinG),
      carbsG: num(parsed.carbsG),
      fatG: num(parsed.fatG),
      fiberG: num(parsed.fiberG),
      sugarG: num(parsed.sugarG),
      sodiumMg: num(parsed.sodiumMg),
    };

    const hasAny = Object.values(nutrition).some((v) => v != null);
    if (!hasAny) return { error: "Could not estimate nutrition for this recipe." };

    await db
      .update(recipes)
      .set({
        calories: nutrition.calories == null ? null : Math.round(nutrition.calories),
        proteinG: nutrition.proteinG == null ? null : String(nutrition.proteinG),
        carbsG: nutrition.carbsG == null ? null : String(nutrition.carbsG),
        fatG: nutrition.fatG == null ? null : String(nutrition.fatG),
        fiberG: nutrition.fiberG == null ? null : String(nutrition.fiberG),
        sugarG: nutrition.sugarG == null ? null : String(nutrition.sugarG),
        sodiumMg: nutrition.sodiumMg == null ? null : String(nutrition.sodiumMg),
        nutritionSource: "ai",
      })
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)));

    revalidatePath(`/recipes/${recipeId}`);
    return { nutrition };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Suggest an existing collection for a recipe ────────────────────────────────
// Best-effort classification: given the household's existing collections, pick
// the one a new recipe clearly belongs in — or none. Never creates collections,
// never throws: callers treat an empty result as "leave it uncategorised".

export type CollectionSuggestion = {
  collectionId?: string;
  collectionName?: string;
  collectionIcon?: string | null;
};

export async function suggestCollectionForRecipe(input: {
  title: string;
  description?: string | null;
  cuisine?: string | null;
  tags?: string[];
  mealTypes?: string[] | null;
}): Promise<CollectionSuggestion> {
  try {
    if (!input.title?.trim()) return {};

    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);

    const existing = await db
      .select({
        id: collections.id,
        name: collections.name,
        icon: collections.icon,
        description: collections.description,
      })
      .from(collections)
      .where(eq(collections.householdId, householdId))
      .orderBy(collections.name);

    if (existing.length === 0) return {};

    const { client, model } = await getOpenAiClient(householdId);

    const collectionList = existing
      .map((c) => `- ${c.name}${c.description?.trim() ? `: ${c.description.trim()}` : ""}`)
      .join("\n");

    const recipeLines = [
      `Title: ${input.title}`,
      input.description?.trim() ? `Description: ${input.description.trim()}` : null,
      input.cuisine?.trim() ? `Cuisine: ${input.cuisine.trim()}` : null,
      input.mealTypes?.length ? `Meal types: ${input.mealTypes.join(", ")}` : null,
      input.tags?.length ? `Tags: ${input.tags.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      ...maxTokensParam(model, 120),
      messages: [
        {
          role: "system",
          content: `You file new recipes into a family's existing recipe collections. Return JSON: {"collection": "<exact collection name>"} or {"collection": null}.
Choose a collection ONLY when the recipe clearly and obviously belongs in it, judging by the collection's name and description. If no collection is a clear fit, return null — leaving a recipe uncategorised is far better than filing it in the wrong place. Never invent a collection name; the value must match one of the listed names exactly, character for character.`,
        },
        {
          role: "user",
          content: `Existing collections:\n${collectionList}\n\nNew recipe:\n${recipeLines}\n\nWhich collection does this recipe belong in?`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { collection?: string | null };
    const picked = typeof parsed.collection === "string" ? parsed.collection.trim().toLowerCase() : "";
    if (!picked) return {};

    const match = existing.find((c) => c.name.trim().toLowerCase() === picked);
    if (!match) return {};

    return { collectionId: match.id, collectionName: match.name, collectionIcon: match.icon };
  } catch {
    // Filing is a nicety — never let it break recipe generation or saving.
    return {};
  }
}

// ── Step 2: Generate full recipe from a chosen concept ─────────────────────────

export async function generateFullRecipe(
  concept: ConceptCard,
  memberIds?: string[],
  mealType?: string,
  targetCalories?: number
): Promise<{ recipe?: GeneratedRecipe; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const [{ client, model, defaultPrompt, kitchenEquipment, measurementSystem }, memberConstraints, tasteAddendum] = await Promise.all([
      getOpenAiClient(householdId),
      buildMemberConstraints(memberIds ?? [], householdId),
      buildTasteProfileAddendum(householdId),
    ]);

    const addendum = buildSystemAddendum(defaultPrompt, measurementSystem, kitchenEquipment) + tasteAddendum + memberConstraints;

    const recipe = await createStructuredRecipe(client, model, [
      {
        role: "system",
        content: `You are a chef writing detailed, family-friendly recipes. Return a complete recipe as JSON matching this exact schema:
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
Use realistic quantities and clear step-by-step instructions. Use groupLabel on both ingredients and steps to group the related parts of a recipe that has genuinely distinct components or sub-recipes (e.g. "Granola" vs "Smoothie", or "Sauce", "Marinade") — use the SAME label for an ingredient group and its matching step group. For a simple single-component recipe leave every groupLabel as an empty string.${addendum}`,
      },
      {
        role: "user",
        content: `Generate a full recipe for: "${concept.title}"\nDescription: ${concept.description}\nCuisine: ${concept.cuisine}\nDifficulty: ${concept.difficulty}${mealType ? `\nMeal type: This must be a ${mealType} recipe — ensure portion size, richness, and style are appropriate for ${mealType}.` : ""}${targetCalories && targetCalories > 0 ? `\nCalorie target: aim for roughly ${targetCalories} kcal per serving — adjust quantities and ingredient choices to land near this.` : ""}`,
      },
    ]);

    return { recipe };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Generate recipe image (returns URL only, does not save to DB) ──────────────
// Used by the edit form so the URL is included in the form submission.

export async function generateRecipeImageUrl(
  title: string,
  description: string | null,
  style?: string | null
): Promise<{ url?: string; thumbnailUrl?: string; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const { client, imageModel } = await getOpenAiClient(householdId);

    if (!isStorageAvailable()) {
      return { error: "Image storage is not configured — add S3 settings to enable AI image generation." };
    }

    const styleSuffix = getStyleSuffix(style);
    const prompt = `Professional food photography of "${title}". ${description ? description + " " : ""}${styleSuffix}`;

    console.log(`[AI] Generating image with model=${imageModel} for "${title}"`);

    const response = await client.images.generate({
      model: imageModel,
      prompt,
      n: 1,
      size: "1024x1024",
    });

    const imageData = response.data?.[0];
    let buffer: Buffer;

    if (imageData?.b64_json) {
      buffer = Buffer.from(imageData.b64_json, "base64");
    } else if (imageData?.url) {
      console.log(`[AI] Model returned URL instead of b64 — fetching to upload`);
      const fetched = await fetch(imageData.url);
      if (!fetched.ok) throw new Error(`Failed to fetch generated image: ${fetched.status}`);
      buffer = Buffer.from(await fetched.arrayBuffer());
    } else {
      console.error(`[AI] Image generation response had no usable data:`, JSON.stringify(response.data));
      throw new Error("No image data returned from AI.");
    }

    const id = randomUUID();
    const [url, thumbnailBuffer] = await Promise.all([
      uploadFile(`recipes/${householdId}/${id}.png`, buffer, "image/png"),
      makeThumbnail(buffer),
    ]);
    const thumbnailUrl = await uploadFile(`recipes/${householdId}/${id}_thumb.jpg`, thumbnailBuffer, "image/jpeg");
    console.log(`[AI] Image uploaded successfully: ${url}`);

    return { url, thumbnailUrl };
  } catch (err) {
    console.error(`[AI] Image generation failed:`, err);
    return { error: classifyError(err) };
  }
}

// ── Generate a week's meal plan as concept slots ───────────────────────────────

export type MealPlanSlot = {
  dayOfWeek: number; // 0=Mon … 6=Sun
  mealType: string;
  title: string;
  description: string;
  cuisine: string;
  difficulty: "easy" | "medium" | "hard";
  recipeId?: string | null; // set when the AI picks from the existing library
};

export async function generateMealPlanConcepts(params: {
  slots: { dayOfWeek: number; mealType: string }[];
  preferences: string;
  cuisineFilter?: string;
  tagFilter?: string;
  unusedOnly?: boolean;
  ratedOnly?: boolean;
  memberIds?: string[];
  maxCaloriesPerMeal?: number;
  /** Monday of the week being planned (YYYY-MM-DD), for seasonality and to
   *  avoid clashing with meals already slotted into that week. */
  weekStartDate?: string;
}): Promise<{ slots?: MealPlanSlot[]; error?: string }> {
  const { slots: requestedSlots, preferences, cuisineFilter, tagFilter, unusedOnly, ratedOnly, memberIds, maxCaloriesPerMeal, weekStartDate } = params;
  if (!requestedSlots.length)
    return { error: "Please select at least one slot to plan." };

  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const safePreferences = preferences.slice(0, 500);
    const [{ client, model, defaultPrompt, kitchenEquipment, measurementSystem }, memberConstraints, tasteAddendum] = await Promise.all([
      getOpenAiClient(householdId),
      buildMemberConstraints((memberIds ?? []).slice(0, 20), householdId),
      buildTasteProfileAddendum(householdId),
    ]);
    const addendum = buildSystemAddendum(defaultPrompt, measurementSystem, kitchenEquipment) + tasteAddendum;

    // Build recipe library context with planner history + ratings
    const today = new Date().toISOString().split("T")[0]!;

    // Resolve tag filter to recipe IDs (household-scoped)
    const taggedIds = tagFilter
      ? await db
          .select({ recipeId: recipeTags.recipeId })
          .from(recipeTags)
          .innerJoin(recipes, eq(recipeTags.recipeId, recipes.id))
          .where(and(eq(recipes.householdId, householdId), eq(recipeTags.tag, tagFilter)))
          .then((rows) => rows.map((r) => r.recipeId))
      : null;

    const noTagMatches = tagFilter && taggedIds !== null && taggedIds.length === 0;

    const rawLibrary = noTagMatches
      ? []
      : await db
          .select({
            id: recipes.id,
            title: recipes.title,
            cuisine: recipes.cuisine,
            difficulty: recipes.difficulty,
            calories: recipes.calories,
            prepTimeMinutes: recipes.prepTimeMinutes,
            cookTimeMinutes: recipes.cookTimeMinutes,
            mealTypes: recipes.mealTypes,
            timesPlanned: count(mealPlanEntries.id),
            lastPlannedDate: max(mealPlans.weekStartDate),
            avgRating: avg(cookHistory.rating),
          })
          .from(recipes)
          .leftJoin(mealPlanEntries, eq(mealPlanEntries.recipeId, recipes.id))
          // No date bound here on purpose: a recipe already slotted into a
          // *future* week must still count as recently planned, otherwise
          // regenerating an upcoming week keeps proposing the same dishes.
          .leftJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
          .leftJoin(cookHistory, eq(cookHistory.recipeId, recipes.id))
          .where(
            and(
              eq(recipes.householdId, householdId),
              cuisineFilter ? eq(recipes.cuisine, cuisineFilter) : undefined,
              taggedIds && taggedIds.length > 0 ? inArray(recipes.id, taggedIds) : undefined,
            )
          )
          .groupBy(
            recipes.id,
            recipes.title,
            recipes.cuisine,
            recipes.difficulty,
            recipes.calories,
            recipes.prepTimeMinutes,
            recipes.cookTimeMinutes,
            recipes.mealTypes
          )
          .limit(200);

    // Whole weeks since a recipe was last planned. Future plans clamp to 0 so a
    // dish already slotted into an upcoming week counts as "just planned".
    // Never planned → null.
    function weeksSincePlanned(dateStr: string | null): number | null {
      if (!dateStr) return null;
      const weeks = Math.floor(
        (Date.now() - new Date(dateStr + "T00:00:00").getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      return Math.max(0, weeks);
    }

    // Recipes used in the last 2 weeks are excluded from the selectable library
    // and passed to the AI as a "do not repeat" list
    const COOLDOWN_WEEKS = 2;
    const recentlyCookedTitles: string[] = [];

    const filteredLibrary = rawLibrary.filter((r) => {
      if (unusedOnly && Number(r.timesPlanned) > 0) return false;
      if (ratedOnly && !r.avgRating) return false;
      // Exclude library recipes over the per-meal calorie cap (recipes with no
      // calorie data are kept — we can't tell, so we don't hide them).
      if (maxCaloriesPerMeal && r.calories != null && r.calories > maxCaloriesPerMeal)
        return false;
      const weeksAgo = weeksSincePlanned(r.lastPlannedDate);
      if (weeksAgo !== null && weeksAgo < COOLDOWN_WEEKS) {
        recentlyCookedTitles.push(r.title);
        return false;
      }
      return true;
    });

    // Score: rating is the main quality signal, and time since last planned is a
    // *bonus* — the longer a recipe has gone unused, the more it deserves a turn.
    // Frequently-planned dishes are damped so favourites don't crowd out the rest.
    function scoreRecipe(r: { avgRating: string | null; timesPlanned: number; lastPlannedDate: string | null }): number {
      const rating = r.avgRating ? parseFloat(r.avgRating) : 3.5;
      const planned = Math.min(Number(r.timesPlanned), 10);
      const weeksAgo = weeksSincePlanned(r.lastPlannedDate);
      // Never tried sits near the top of the neglect curve without beating a
      // well-loved recipe that has simply been rested for a few months.
      const neglectBonus = weeksAgo === null ? 34 : Math.min(weeksAgo, 26) * 1.5;
      const overuseP = planned * 1.5;
      // Small jitter so consecutive generations don't produce an identical ranking.
      const jitter = Math.random() * 8;
      return rating * 12 + neglectBonus - overuseP + jitter;
    }

    const scored = [...filteredLibrary].sort((a, b) => scoreRecipe(b) - scoreRecipe(a));
    const topPicks = scored.slice(0, 45);

    // Variety bucket: most-neglected recipes from the remainder
    const varietyPicks = scored
      .slice(45)
      .sort((a, b) => (weeksSincePlanned(b.lastPlannedDate) ?? 999) - (weeksSincePlanned(a.lastPlannedDate) ?? 999))
      .slice(0, 30);

    // Shuffle the combined list before numbering it: presenting recipes in rank
    // order makes the model gravitate to the first few entries every time. The
    // per-recipe rating and history text still carries the quality signal.
    const libraryRecipes = [...topPicks, ...varietyPicks];
    for (let i = libraryRecipes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [libraryRecipes[i], libraryRecipes[j]] = [libraryRecipes[j]!, libraryRecipes[i]!];
    }

    // Tags and cook notes are fetched only for the ~75 recipes that actually
    // reach the prompt, not the whole 200-row library scan.
    const libraryIds = libraryRecipes.map((r) => r.id);

    const [tagRows, noteRows] = libraryIds.length
      ? await Promise.all([
          db
            .select({ recipeId: recipeTags.recipeId, tag: recipeTags.tag })
            .from(recipeTags)
            .where(inArray(recipeTags.recipeId, libraryIds)),
          // Most recent cook note per recipe — the "took ages" / "too spicy for
          // the kids" feedback that should steer slot choice.
          db
            .select({
              recipeId: cookHistory.recipeId,
              notes: cookHistory.notes,
              cookedAt: cookHistory.cookedAt,
            })
            .from(cookHistory)
            .where(and(inArray(cookHistory.recipeId, libraryIds), isNotNull(cookHistory.notes)))
            .orderBy(desc(cookHistory.cookedAt)),
        ])
      : [[], []];

    const tagsByRecipe = new Map<string, string[]>();
    for (const row of tagRows) {
      const list = tagsByRecipe.get(row.recipeId);
      if (list) list.push(row.tag);
      else tagsByRecipe.set(row.recipeId, [row.tag]);
    }

    // Rows arrive newest-first, so the first note seen for a recipe is the latest.
    const noteByRecipe = new Map<string, string>();
    for (const row of noteRows) {
      const note = row.notes?.trim();
      if (!note || noteByRecipe.has(row.recipeId)) continue;
      noteByRecipe.set(row.recipeId, note.length > 120 ? `${note.slice(0, 117)}…` : note);
    }

    function relativeWeeks(dateStr: string | null): string {
      if (!dateStr) return "never tried";
      const diffWeeks = Math.floor(
        (new Date(today + "T00:00:00").getTime() - new Date(dateStr + "T00:00:00").getTime()) /
          (7 * 24 * 60 * 60 * 1000)
      );
      if (diffWeeks <= 0) return "this week";
      if (diffWeeks === 1) return "1 week ago";
      if (diffWeeks < 8) return `${diffWeeks} weeks ago`;
      return `${Math.floor(diffWeeks / 4)} months ago`;
    }

    const libraryContext = libraryRecipes.length > 0
      ? `\n\nRECIPE LIBRARY — use "libraryIndex" to reference these (1-based). Each recipe can only appear once per plan. The list is in no particular order: judge each entry on its rating and history, not its position. A "note:" is the household's own feedback from the last time they cooked it — treat it as authoritative and let it steer which slot the recipe suits, or whether to pick it at all.\n` +
        libraryRecipes
          .map((r, i) => {
            const times = Number(r.timesPlanned);
            const rating = r.avgRating ? `⭐${parseFloat(r.avgRating).toFixed(1)}` : "unrated";
            const history = times === 0 ? "never tried" : `cooked ${times}×, ${relativeWeeks(r.lastPlannedDate)}`;
            const cals = r.calories != null ? `, ~${r.calories}kcal` : "";
            const totalTime = (r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0);
            const time = totalTime > 0 ? `, ${totalTime}min` : "";
            const meals = r.mealTypes && r.mealTypes.length
              ? `, suits: ${r.mealTypes.join("/")}`
              : ", suits: untagged";
            const tagList = tagsByRecipe.get(r.id);
            const tags = tagList?.length ? `, tags: ${tagList.slice(0, 6).join("/")}` : "";
            const note = noteByRecipe.get(r.id);
            const noteText = note ? ` — note: "${note}"` : "";
            return `#${i + 1} ${r.title} [${r.cuisine ?? "various"}, ${r.difficulty ?? "medium"}, ${rating}${cals}${time}${tags}${meals}] — ${history}${noteText}`;
          })
          .join("\n") +
        `\n\nFor each slot: set "libraryIndex" to the recipe's # to reuse it, or 0 to suggest a brand-new recipe. STRICT RULE: only reuse a library recipe in a slot whose meal type is listed in that recipe's "suits:" field. For recipes marked "suits: untagged" the meal type is unknown — only reuse one in a breakfast/snack/dessert slot if its title makes it unmistakably suitable; when in doubt use 0. If nothing in the library suits the slot, use 0 and suggest a fitting new recipe instead.

VARIETY IS A PRIORITY. Actively spread your picks across the library rather than clustering on the same few favourites: deliberately give "never tried" recipes and ones last cooked months ago a turn, and vary cuisine and main protein across the week. A plan that reuses this household's usual rotation is a poor plan. Aim for at least one never-tried or long-neglected recipe in every plan of three or more slots.`
      : "";

    const recentlyUsedBlock = recentlyCookedTitles.length > 0
      ? `\n\nRECENTLY COOKED (last ${COOLDOWN_WEEKS} weeks) — do NOT suggest these again this week: ${recentlyCookedTitles.join(", ")}.`
      : "";

    const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    // Meals already sitting in the target week. The planner only asks the AI to
    // fill the empty slots, so without this it can't see what it's planning
    // around and will happily repeat a cuisine or protein already on the board.
    const alreadyPlanned = weekStartDate
      ? await db
          .select({
            dayOfWeek: mealPlanEntries.dayOfWeek,
            mealType: mealPlanEntries.mealType,
            title: recipes.title,
            cuisine: recipes.cuisine,
          })
          .from(mealPlanEntries)
          .innerJoin(mealPlans, eq(mealPlanEntries.mealPlanId, mealPlans.id))
          .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
          .where(
            and(
              eq(mealPlans.householdId, householdId),
              eq(mealPlans.weekStartDate, weekStartDate)
            )
          )
      : [];

    const alreadyPlannedBlock = alreadyPlanned.length > 0
      ? `\n\nALREADY PLANNED THIS WEEK (do not repeat these dishes, and balance your suggestions against them so the week isn't dominated by one cuisine or protein): ` +
        alreadyPlanned
          .map((e) => `${DAY_NAMES[e.dayOfWeek]} ${e.mealType} — ${e.title}${e.cuisine ? ` (${e.cuisine})` : ""}`)
          .join("; ") +
        "."
      : "";

    // Seasonality: plan around what's actually good in the month being planned.
    const seasonBlock = (() => {
      const target = weekStartDate ? new Date(weekStartDate + "T00:00:00") : new Date();
      if (Number.isNaN(target.getTime())) return "";
      const monthName = target.toLocaleString("en-GB", { month: "long" });
      return `\n\nThis plan is for the week beginning ${target.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. Favour dishes and produce that suit ${monthName} in the UK — lighter, fresher food in warm months, and slower, heartier food in cold ones.`;
    })();

    const filterHints = [
      cuisineFilter ? `When suggesting new recipes (libraryIndex 0), prefer ${cuisineFilter} cuisine.` : "",
      tagFilter ? `New recipe suggestions should fit the theme or tag "${tagFilter}".` : "",
      unusedOnly ? "Prefer library recipes marked as never tried (libraryIndex 0 is also fine for fresh ideas)." : "",
      ratedOnly ? "Only reference library recipes that have a star rating; use libraryIndex 0 for any slot where you'd otherwise pick an unrated recipe." : "",
    ].filter(Boolean).join(" ");
    const calorieBlock = maxCaloriesPerMeal
      ? `\n\nCALORIE LIMIT: every meal must stay at or below roughly ${maxCaloriesPerMeal} kcal per serving. Library recipes shown with a kcal value already fit. For new suggestions (libraryIndex 0) and any library recipe without a kcal value, choose dishes whose typical per-serving calories are within this limit.`
      : "";
    const fullAddendum =
      addendum +
      recentlyUsedBlock +
      alreadyPlannedBlock +
      seasonBlock +
      calorieBlock +
      (filterHints ? `\n\n${filterHints}` : "") +
      memberConstraints;

    const slots = requestedSlots;
    const slotsDesc = slots
      .map((s) => `${DAY_NAMES[s.dayOfWeek]} ${s.mealType}`)
      .join(", ");

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      ...maxTokensParam(model, 2000),
      messages: [
        {
          role: "system",
          content: `You are a meal planning chef helping a family plan their week. Return meal suggestions as JSON.
Format: {"slots": [{"dayOfWeek": number, "mealType": string, "title": string, "description": "1-2 sentences", "cuisine": string, "difficulty": "easy"|"medium"|"hard", "libraryIndex": number}]}
Make meals varied across the week.
CRITICAL — each suggestion MUST genuinely suit its slot's meal type:
- breakfast: breakfast-appropriate food only (eggs, pancakes, porridge, pastries, granola, fruit, breakfast wraps, etc.). Never put rich dinner-style dishes (pasta, curries, roasts, stews) in a breakfast slot.
- lunch: light, quick, midday food — salads, sandwiches, wraps, soups, grain bowls, leftovers-style plates. Keep portions and richness modest; do NOT assign full dinner-style mains to lunch.
- dinner: the main heartier meal of the day.
- snack: small, simple bites. dessert: sweet courses only.
If a slot's meal type can't be satisfied by a sensible dish, suggest a new one (libraryIndex 0) rather than forcing an ill-fitting recipe.
dayOfWeek must match: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday.${libraryContext}${fullAddendum}`,
        },
        {
          role: "user",
          content: `Plan these meals: ${slotsDesc}.${safePreferences ? ` Preferences: ${safePreferences}` : ""} Return exactly ${slots.length} suggestions.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { slots: (Omit<MealPlanSlot, "recipeId"> & { libraryIndex?: number })[] };
    if (!Array.isArray(parsed.slots) || parsed.slots.length === 0)
      throw new Error("Unexpected AI response format.");

    // Resolve libraryIndex → recipeId
    const resolvedSlots: MealPlanSlot[] = parsed.slots.map((slot) => {
      const idx = slot.libraryIndex;
      if (idx && idx > 0 && idx <= libraryRecipes.length) {
        const lib = libraryRecipes[idx - 1]!;
        // Hard guard: if the recipe declares meal types and the slot's type
        // isn't among them, the model mis-assigned it (e.g. a dinner dish into
        // a breakfast slot). Drop the reuse and keep the slot as a new concept.
        if (lib.mealTypes && lib.mealTypes.length && !lib.mealTypes.includes(slot.mealType)) {
          return { ...slot, recipeId: null };
        }
        return {
          ...slot,
          title: lib.title,
          cuisine: lib.cuisine ?? slot.cuisine,
          difficulty: (lib.difficulty ?? slot.difficulty) as MealPlanSlot["difficulty"],
          recipeId: lib.id,
        };
      }
      return { ...slot, recipeId: null };
    });

    return { slots: resolvedSlots };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Scan a recipe photo and extract a full structured recipe ──────────────────

export async function analyzeRecipePhoto(
  base64Image: string,
  mimeType: string
): Promise<{ recipe?: GeneratedRecipe; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const { client, model, defaultPrompt, kitchenEquipment, measurementSystem } =
      await getOpenAiClient(householdId);

    const addendum = buildSystemAddendum(defaultPrompt, measurementSystem, kitchenEquipment);

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      ...maxTokensParam(model, 3000),
      messages: [
        {
          role: "system",
          content: `You are a recipe digitisation assistant. Extract the complete recipe from the provided image and return it as JSON matching this exact schema:
{
  "title": string,
  "description": string (1–2 sentences summarising the dish),
  "cuisine": string (e.g. "Italian", "British", "Asian"),
  "difficulty": "easy"|"medium"|"hard",
  "prepTimeMinutes": number|null,
  "cookTimeMinutes": number|null,
  "servings": string (numeric string, e.g. "4"),
  "servingsUnit": string (e.g. "servings", "portions", "pieces"),
  "tags": string[],
${MEAL_TYPES_SCHEMA_FRAGMENT},
  "ingredients": [
    {
      "ingredientName": string,
      "amount": string (numeric string or empty if not specified),
      "unit": string (e.g. "g", "ml", "tsp", "tbsp", "cup", or empty string),
      "preparation": string (e.g. "finely chopped" — use empty string if none, never "none"),
      "isOptional": boolean,
      "groupLabel": string (section heading such as "For the sauce" — empty string if none)
    }
  ],
  "steps": [
    {
      "instruction": string,
      "durationMinutes": string (numeric string or empty if no duration mentioned),
      "timerLabel": string (short label for a timer e.g. "simmer" — empty string if no timer),
      "groupLabel": string (section heading such as "For the sauce" if the image groups the method into named parts — use the same label as the matching ingredient group; empty string if none)
    }
  ],
  "notes": string|null (any tips, storage advice, or variations shown in the image)
}
If a value is not present in the image use null for nullable fields or an empty string/array for others. Never invent information not visible in the image.${addendum}`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: "high",
              },
            },
            {
              type: "text",
              text: "Please extract the complete recipe from this image.",
            },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as GeneratedRecipe;

    if (!parsed.title || !Array.isArray(parsed.ingredients) || !Array.isArray(parsed.steps)) {
      throw new Error("Could not extract a complete recipe from the image.");
    }

    return { recipe: parsed };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Review a dish photo with AI vision ────────────────────────────────────────

export async function reviewDishPhoto(
  recipeTitle: string,
  photoUrl: string
): Promise<{ feedback?: string; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const { client, model } = await getOpenAiClient(householdId);

    // Only fetch from our own storage to prevent SSRF
    if (!keyFromUrl(photoUrl)) return { error: "Invalid photo URL." };

    // Fetch image server-side (handles internal MinIO URLs unreachable by OpenAI)
    const res = await fetch(photoUrl);
    if (!res.ok) return { error: "Could not load photo for review." };
    const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";

    const completion = await client.chat.completions.create({
      model,
      ...maxTokensParam(model, 200),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You're looking at a home-cooked dish. The recipe was "${recipeTitle}". Give 2–3 sentences of warm, specific feedback: comment on the colour or presentation, and offer one practical tip to improve the plating or result next time. Be encouraging and personal.`,
            },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}`, detail: "low" },
            },
          ],
        },
      ],
    });

    const feedback = completion.choices[0]?.message?.content?.trim() ?? null;
    if (!feedback) return { error: "No feedback returned." };
    return { feedback };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Generate and save recipe image (updates DB directly) ──────────────────────
// Used by the recipe detail page button.

export async function generateAndSaveRecipeImage(
  recipeId: string
): Promise<{ imageUrl?: string; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);

    const [recipe] = await db
      .select({ title: recipes.title, description: recipes.description })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
      .limit(1);

    if (!recipe) return { error: "Recipe not found." };

    const { url, error } = await generateRecipeImageUrl(recipe.title, recipe.description);
    if (error || !url) return { error: error ?? "Image generation failed." };

    await db.update(recipes).set({ imageUrl: url }).where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)));
    console.log(`[AI] Saved image URL to recipe ${recipeId}: ${url}`);
    revalidatePath(`/recipes/${recipeId}`);
    revalidatePath("/recipes");

    return { imageUrl: url };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Backfill meal types for existing recipes (admin one-off) ───────────────────
// Classifies every recipe that has no mealTypes yet, so the weekly planner can
// match library recipes to slots. Admin only.

export async function backfillRecipeMealTypes(): Promise<{
  total?: number;
  updated?: number;
  error?: string;
}> {
  try {
    const user = await getAutheliaUser();
    const { householdId, role } = await requireHousehold(user);
    if (role !== "admin") return { error: "Admin only." };

    const pending = await db
      .select({ id: recipes.id, title: recipes.title, cuisine: recipes.cuisine })
      .from(recipes)
      .where(and(eq(recipes.householdId, householdId), isNull(recipes.mealTypes)));

    if (!pending.length) return { total: 0, updated: 0 };

    const { client, model } = await getOpenAiClient(householdId);

    let updated = 0;
    const BATCH = 40;
    for (let start = 0; start < pending.length; start += BATCH) {
      const batch = pending.slice(start, start + BATCH);
      const list = batch
        .map((r, i) => `${i}: ${r.title}${r.cuisine ? ` (${r.cuisine})` : ""}`)
        .join("\n");

      const completion = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        ...maxTokensParam(model, 1500),
        messages: [
          {
            role: "system",
            content: `You classify recipes by which meals they genuinely suit. Allowed values: ${MEAL_TYPES.join(", ")}. Be realistic: a rich curry/roast/stew is ["dinner"] (maybe "lunch"); eggs/pancakes/porridge/granola are ["breakfast"]; a light salad or grain bowl is ["lunch","dinner"] but NOT "breakfast"; cakes/puddings are ["dessert"]. Never include a meal a normal person wouldn't eat the dish for. Return JSON: {"results": [{"i": number (the line index), "mealTypes": string[]}]}. Include every index.`,
          },
          { role: "user", content: `Classify these recipes:\n${list}` },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      let parsed: { results?: { i: number; mealTypes?: string[] }[] };
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue; // skip an unparseable batch rather than aborting the whole run
      }

      for (const row of parsed.results ?? []) {
        const recipe = batch[row.i];
        if (!recipe) continue;
        const valid = [...new Set(row.mealTypes ?? [])].filter((v) =>
          (MEAL_TYPES as readonly string[]).includes(v)
        );
        if (!valid.length) continue;
        await db
          .update(recipes)
          .set({ mealTypes: valid })
          .where(and(eq(recipes.id, recipe.id), eq(recipes.householdId, householdId)));
        updated++;
      }
    }

    revalidatePath("/recipes");
    return { total: pending.length, updated };
  } catch (err) {
    return { error: classifyError(err) };
  }
}
