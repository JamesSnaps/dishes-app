"use server";

import OpenAI from "openai";
import { db } from "@/lib/db";
import { aiConfigurations } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

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

async function getOpenAiClient(
  householdId: string
): Promise<{ client: OpenAI; model: string }> {
  const [config] = await db
    .select({
      encryptedApiKey: aiConfigurations.encryptedApiKey,
      model: aiConfigurations.model,
    })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);

  if (!config)
    throw new Error("AI not configured. Add your API key in Settings → AI.");

  const apiKey = decrypt(config.encryptedApiKey);
  return { client: new OpenAI({ apiKey }), model: config.model };
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

// ── Step 1: Generate 5 concept cards ──────────────────────────────────────────

export async function generateConcepts(
  prompt: string
): Promise<{ concepts?: ConceptCard[]; error?: string }> {
  if (!prompt.trim())
    return { error: "Please describe what you'd like to cook." };

  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const { client, model } = await getOpenAiClient(householdId);

    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content: `You are a creative chef helping a family choose what to cook. Return exactly 5 distinct recipe concepts as JSON.
Format: {"concepts": [{"title": "...", "description": "1-2 sentences", "cuisine": "...", "tags": ["..."], "difficulty": "easy"|"medium"|"hard"}]}
Make the 5 concepts meaningfully different from each other in style, cuisine, or complexity.`,
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

// ── Step 2: Generate full recipe from a chosen concept ─────────────────────────

export async function generateFullRecipe(
  concept: ConceptCard
): Promise<{ recipe?: GeneratedRecipe; error?: string }> {
  try {
    const user = await getAutheliaUser();
    const { householdId } = await requireHousehold(user);
    const { client, model } = await getOpenAiClient(householdId);

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
Use realistic quantities and clear step-by-step instructions. Use groupLabel (e.g. "Sauce", "Marinade") to group related ingredients; leave empty string for ungrouped.`,
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
