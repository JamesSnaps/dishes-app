import { z } from "zod";

/** Wire formats for /api/v1/cook-history. Ratings are 0–10, half-star precision. */

const rating = z.number().min(0).max(10);
const memberRatings = z.array(z.object({ name: z.string().min(1), rating })).nullable();

export const logCookSchema = z.object({
  recipeId: z.string().uuid(),
  rating: rating.nullable().optional(),
  actualDuration: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
  occasion: z.string().nullable().optional(),
  cookedFor: z.array(z.string()).nullable().optional(),
  memberRatings: memberRatings.optional(),
});

/** A rating without a cook — counts towards the average, not the cook count. */
export const rateRecipeSchema = z.object({
  recipeId: z.string().uuid(),
  rating,
  notes: z.string().optional(),
});

export const updateCookSchema = z
  .object({
    rating: rating.nullable(),
    actualDuration: z.number().int().nonnegative().nullable(),
    notes: z.string().nullable(),
    occasion: z.string().nullable(),
    cookedFor: z.array(z.string()).nullable(),
    memberRatings,
    removePhoto: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

export const historyQuerySchema = z.object({ recipeId: z.string().uuid() });
