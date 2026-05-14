"use server";

import OpenAI from "openai";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { aiConfigurations, recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { uploadFile, isStorageAvailable } from "@/lib/storage";
import { revalidatePath } from "next/cache";

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
  }>;
  notes: string | null;
};

// ── Internal helpers ───────────────────────────────────────────────────────────

type AiConfig = {
  client: OpenAI;
  model: string;
  imageModel: string;
  defaultPrompt: string | null;
  measurementSystem: string;
};

async function getOpenAiClient(householdId: string): Promise<AiConfig> {
  const [config] = await db
    .select({
      encryptedApiKey: aiConfigurations.encryptedApiKey,
      model: aiConfigurations.model,
      imageModel: aiConfigurations.imageModel,
      defaultPrompt: aiConfigurations.defaultPrompt,
      measurementSystem: aiConfigurations.measurementSystem,
    })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);

  if (!config)
    throw new Error("AI not configured. Add your API key in Settings → AI.");

  const apiKey = decrypt(config.encryptedApiKey);
  return {
    client: new OpenAI({ apiKey }),
    model: config.model,
    imageModel: config.imageModel,
    defaultPrompt: config.defaultPrompt,
    measurementSystem: config.measurementSystem,
  };
}

function classifyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Incorrect API key") || msg.includes("invalid_api_key"))
    return "Invalid API key — check Settings → AI.";
  if (msg.includes("429") || msg.includes("quota") || msg.includes("rate limit"))
    return "OpenAI rate limit or quota exceeded. Try again shortly.";
  if (msg.includes("timeout") || msg.includes("ETIMEDOUT"))
    return "Request timed out. Try again.";
  return `AI error: ${msg}`;
}

function buildSystemAddendum(defaultPrompt: string | null, measurementSystem: string): string {
  const parts: string[] = [];
  if (measurementSystem === "metric") {
    parts.push(
      "Always use metric measurements only: grams (g), millilitres (ml), kilograms (kg), litres (l). Never use cups, tablespoons, teaspoons, fluid ounces, pounds, or any other imperial or US customary units."
    );
  }
  if (defaultPrompt?.trim()) {
    parts.push(defaultPrompt.trim());
  }
  return parts.length ? `\n\nAdditional requirements: ${parts.join(" ")}` : "";
}

// ── Step 1: Generate 5 concept cards ──────────────────────────────────────────

export async function generateConcepts(
  prompt: string
): Promise<{ concepts?: ConceptCard[]; error?: string }> {
  if (!prompt.trim())
    return { error: "Please describe what you'd like to cook." };

  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const { client, model, defaultPrompt, measurementSystem } = await getOpenAiClient(householdId);

    const addendum = buildSystemAddendum(defaultPrompt, measurementSystem);

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content: `You are a creative chef helping a family choose what to cook. Return exactly 5 distinct recipe concepts as JSON.
Format: {"concepts": [{"title": "...", "description": "1-2 sentences", "cuisine": "...", "tags": ["..."], "difficulty": "easy"|"medium"|"hard"}]}
Make the 5 concepts meaningfully different from each other in style, cuisine, or complexity.${addendum}`,
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

// ── Improve an existing recipe ─────────────────────────────────────────────────

export async function improveRecipe(
  current: GeneratedRecipe,
  instruction: string
): Promise<{ recipe?: GeneratedRecipe; error?: string }> {
  if (!instruction.trim())
    return { error: "Please describe how you'd like to improve the recipe." };

  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const { client, model, defaultPrompt, measurementSystem } = await getOpenAiClient(householdId);

    const addendum = buildSystemAddendum(defaultPrompt, measurementSystem);

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      max_tokens: 3000,
      messages: [
        {
          role: "system",
          content: `You are a chef editing an existing recipe based on a user's request. Return the complete modified recipe as JSON matching this exact schema:
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
    {"ingredientName": string, "amount": string, "unit": string, "preparation": string, "isOptional": boolean, "groupLabel": string}
  ],
  "steps": [
    {"instruction": string, "durationMinutes": string, "timerLabel": string}
  ],
  "notes": string|null
}
Only change what is necessary to satisfy the user's request. Preserve everything else exactly. Return the full recipe even for fields you did not change.${addendum}`,
        },
        {
          role: "user",
          content: `Here is the current recipe:\n${JSON.stringify(current, null, 2)}\n\nUser request: ${instruction}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const recipe = JSON.parse(raw) as GeneratedRecipe;

    if (
      !recipe.title ||
      !Array.isArray(recipe.ingredients) ||
      !Array.isArray(recipe.steps)
    ) {
      throw new Error("Incomplete recipe returned by AI.");
    }

    return { recipe };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Step 2: Generate full recipe from a chosen concept ─────────────────────────

export async function generateFullRecipe(
  concept: ConceptCard
): Promise<{ recipe?: GeneratedRecipe; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const { client, model, defaultPrompt, measurementSystem } = await getOpenAiClient(householdId);

    const addendum = buildSystemAddendum(defaultPrompt, measurementSystem);

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      max_tokens: 2500,
      messages: [
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
    {"ingredientName": string, "amount": string, "unit": string, "preparation": string, "isOptional": boolean, "groupLabel": string}
  ],
  "steps": [
    {"instruction": string, "durationMinutes": string (empty string if no timer), "timerLabel": string (empty string if no timer)}
  ],
  "notes": string|null
}
Use realistic quantities and clear step-by-step instructions. Use groupLabel (e.g. "Sauce", "Marinade") to group related ingredients; leave empty string for ungrouped.${addendum}`,
        },
        {
          role: "user",
          content: `Generate a full recipe for: "${concept.title}"\nDescription: ${concept.description}\nCuisine: ${concept.cuisine}\nDifficulty: ${concept.difficulty}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const recipe = JSON.parse(raw) as GeneratedRecipe;

    if (
      !recipe.title ||
      !Array.isArray(recipe.ingredients) ||
      !Array.isArray(recipe.steps)
    ) {
      throw new Error("Incomplete recipe returned by AI.");
    }

    return { recipe };
  } catch (err) {
    return { error: classifyError(err) };
  }
}

// ── Generate recipe image (returns URL only, does not save to DB) ──────────────
// Used by the edit form so the URL is included in the form submission.

export async function generateRecipeImageUrl(
  title: string,
  description: string | null
): Promise<{ url?: string; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const { client, imageModel } = await getOpenAiClient(householdId);

    if (!isStorageAvailable()) {
      return { error: "Image storage is not configured — add S3 settings to enable AI image generation." };
    }

    const prompt = `Professional food photography of "${title}". ${description ? description + " " : ""}Beautifully plated, appetising, clean background, natural lighting. No text, no labels, no watermarks.`;

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

    const key = `recipes/${householdId}/${randomUUID()}.png`;
    const url = await uploadFile(key, buffer, "image/png");
    console.log(`[AI] Image uploaded successfully: ${url}`);

    return { url };
  } catch (err) {
    console.error(`[AI] Image generation failed:`, err);
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

    await db.update(recipes).set({ imageUrl: url }).where(eq(recipes.id, recipeId));
    console.log(`[AI] Saved image URL to recipe ${recipeId}: ${url}`);
    revalidatePath(`/recipes/${recipeId}`);
    revalidatePath("/recipes");

    return { imageUrl: url };
  } catch (err) {
    return { error: classifyError(err) };
  }
}
