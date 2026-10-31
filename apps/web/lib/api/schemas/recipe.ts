import { z } from "zod";
import {
  buildNutrition,
  sanitizeMealTypes,
  type RecipeWriteInput,
} from "@/lib/services/recipes";

/**
 * Wire format for recipe writes on /api/v1. Deliberately JSON-native — the web
 * form's FormData shape (JSON-in-a-string fields, comma-separated tags) is a
 * browser artefact and is not reproduced here.
 */

/** A string field that also takes a number (an amount of 600, 20 minutes). */
const looseText = z.union([z.string(), z.number()]).default("").transform(String);

const ingredientSchema = z.object({
  ingredientName: z.string().min(1),
  amount: looseText,
  unit: z.string().default(""),
  preparation: z.string().default(""),
  isOptional: z.boolean().default(false),
  groupLabel: z.string().default(""),
});

const stepSchema = z.object({
  instruction: z.string().min(1),
  durationMinutes: looseText,
  timerLabel: z.string().default(""),
  groupLabel: z.string().default(""),
  /** The ingredients this step uses, by position in `ingredients`. */
  ingredientIndexes: z.array(z.number().int().nonnegative()).default([]),
});

const nutritionSchema = z.object({
  calories: z.number().nullable().optional(),
  proteinG: z.number().nullable().optional(),
  carbsG: z.number().nullable().optional(),
  fatG: z.number().nullable().optional(),
  saturatedFatG: z.number().nullable().optional(),
  fiberG: z.number().nullable().optional(),
  sugarG: z.number().nullable().optional(),
  sodiumMg: z.number().nullable().optional(),
});

export const recipeWriteSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().default(null),
  cuisine: z.string().nullable().default(null),
  prepTimeMinutes: z.number().int().nonnegative().nullable().default(null),
  cookTimeMinutes: z.number().int().nonnegative().nullable().default(null),
  servings: z.union([z.string(), z.number()]).nullable().default(null).transform((v) => (v == null ? null : String(v))),
  servingsUnit: z.string().default("servings"),
  difficulty: z.enum(["easy", "medium", "hard"]).nullable().default(null),
  mealRole: z.enum(["main", "side", "sauce", "other"]).nullable().optional(),
  mealTypes: z.array(z.string()).nullable().default(null),
  sourceUrl: z.string().url().nullable().default(null),
  notes: z.string().nullable().default(null),
  imageUrl: z.string().nullable().default(null),
  thumbnailUrl: z.string().nullable().default(null),
  nutrition: nutritionSchema.nullable().default(null),
  ingredients: z.array(ingredientSchema).default([]),
  steps: z.array(stepSchema).default([]),
  tags: z.array(z.string()).default([]),
  collectionId: z.string().uuid().nullable().default(null),
});

export type RecipeWritePayload = z.infer<typeof recipeWriteSchema>;

export function toWriteInput(payload: RecipeWritePayload): RecipeWriteInput {
  const { nutrition, ingredients, steps, tags, collectionId, ...fields } = payload;

  return {
    fields: {
      ...fields,
      mealTypes: sanitizeMealTypes(fields.mealTypes),
      ...buildNutrition(nutrition, "manual"),
    },
    ingredients,
    steps,
    tags,
    collectionId,
  };
}

/** Query params for GET /api/v1/recipes. */
export const recipeListQuerySchema = z.object({
  q: z.string().optional(),
  cuisine: z.string().optional(),
  role: z.enum(["main", "side", "sauce", "other"]).optional(),
  favourites: z.enum(["0", "1"]).optional(),
  heartHealthy: z.enum(["0", "1"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  maxTime: z.coerce.number().int().positive().optional(),
  tags: z.string().optional(),
  sort: z.enum(["recent", "title", "time"]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
