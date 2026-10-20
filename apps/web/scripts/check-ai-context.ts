/**
 * Checks the two halves of Phase D0 that the iOS app's on-device AI leans on:
 * the taste-profile summary `GET /api/v1/ai/context` sends (the same lists the
 * server's own prompts use), and what `POST /api/v1/recipes/generated` accepts
 * from the device. Also that fixtures/wire/ai-context.json — the file the Swift
 * tests decode — still has every field the server sends.
 *
 * Usage (from apps/web): npx tsx scripts/check-ai-context.ts
 * Pure — no database or network.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summariseTasteProfile } from "../lib/ai/taste-summary";
import { savedGeneratedRecipeSchema } from "../lib/ai/recipe-generation";
import type { AiContext } from "../lib/services/ai-context";

// --- Taste profile ------------------------------------------------------------

assert.equal(summariseTasteProfile(null), null);
assert.equal(
  summariseTasteProfile({ cuisines: { Thai: 5 }, ingredients: {}, ratedCookCount: 9 }),
  null,
  "fewer than ten rated cooks says nothing"
);

const summary = summariseTasteProfile({
  cuisines: { Thai: 4.5, Italian: 4.8, Mexican: 3, Indian: 4, French: 2, Greek: 3.5 },
  ingredients: { garlic: 4.6, coriander: 1.2, lime: 3.0, olives: 1.5, mushrooms: 2.9 },
  ratedCookCount: 12,
});
assert.ok(summary);
assert.deepEqual(
  summary.preferredCuisines.map((c) => c.name),
  ["Italian", "Thai", "Indian", "Greek", "Mexican"],
  "the top five cuisines, best first"
);
assert.deepEqual(summary.lovedIngredients, ["garlic", "lime"], "3.0 and up is loved");
assert.deepEqual(summary.dislikedIngredients, ["coriander", "olives"], "1.5 and below is disliked, worst first");

// --- A recipe from the device -------------------------------------------------

const fromDevice = {
  title: "Pea and mint soup",
  description: "",
  cuisine: "British",
  difficulty: "easy",
  prepTimeMinutes: 10,
  cookTimeMinutes: 15,
  servings: "4",
  servingsUnit: "servings",
  mealTypes: ["lunch"],
  tags: [],
  ingredients: [
    { ingredientName: "frozen peas", amount: "500", unit: "g", preparation: "", isOptional: false, groupLabel: "" },
  ],
  steps: [{ instruction: "Simmer the peas.", durationMinutes: "10", timerLabel: "Peas", groupLabel: "" }],
  notes: null,
};
assert.ok(savedGeneratedRecipeSchema.safeParse(fromDevice).success, "no nutrition or meal role is fine");
assert.ok(savedGeneratedRecipeSchema.safeParse({ ...fromDevice, collectionId: null }).success, "null files it nowhere");
assert.ok(
  savedGeneratedRecipeSchema.safeParse({ ...fromDevice, collectionId: "0b8f2c1e-5d4a-4c3b-9a2e-7f6d5c4b3a21" }).success
);
assert.ok(!savedGeneratedRecipeSchema.safeParse({ ...fromDevice, collectionId: "Soups" }).success, "a name isn't an id");
assert.ok(!savedGeneratedRecipeSchema.safeParse({ ...fromDevice, steps: [] }).success, "a recipe needs steps");
assert.ok(!savedGeneratedRecipeSchema.safeParse({ ...fromDevice, isFavourite: true }).success, "unknown fields are refused");

// --- The fixture the Swift tests read ------------------------------------------

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../fixtures/wire/ai-context.json"), "utf8")
) as Record<string, unknown>;
// Every field of AiContext, or this doesn't typecheck.
const fields: Record<keyof AiContext, true> = {
  configured: true,
  measurementSystem: true,
  defaultPrompt: true,
  kitchenEquipment: true,
  webGrounding: true,
  members: true,
  tasteProfile: true,
  collections: true,
};
assert.deepEqual(
  Object.keys(fixture).sort(),
  Object.keys(fields).sort(),
  "fixtures/wire/ai-context.json has the server's fields"
);

console.log("ai-context: all checks passed");
