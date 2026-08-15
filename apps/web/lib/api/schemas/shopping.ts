import { z } from "zod";

/** Wire formats for /api/v1/shopping. */

export const addItemSchema = z.object({
  ingredientName: z.string().min(1, "ingredientName required"),
  amount: z.string().nullable().default(null),
  unit: z.string().nullable().default(null),
  category: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  /** Client-generated id, for offline-created items keeping their identity. */
  id: z.string().uuid().optional(),
  /** Defaults to the active list, creating one if none exists. */
  listId: z.string().uuid().optional(),
  position: z.number().int().nonnegative().optional(),
});

/**
 * Every field optional, but at least one must be present — an empty body is a
 * client bug, not a no-op.
 */
export const updateItemSchema = z
  .object({
    ingredientName: z.string().min(1),
    amount: z.string().nullable(),
    unit: z.string().nullable(),
    notes: z.string().nullable(),
    category: z.string().nullable(),
  })
  .partial();

export const toggleItemSchema = z.object({
  checked: z.boolean(),
});

export const listIdSchema = z.object({
  listId: z.string().uuid(),
});

export const generateSchema = z.object({
  recipeId: z.string().uuid(),
  servings: z.number().positive().optional(),
  /** Ingredient names to add even though the pantry covers them. */
  forceInclude: z.array(z.string()).optional(),
});

export const previewQuerySchema = z.object({
  recipeId: z.string().uuid(),
  servings: z.coerce.number().positive().optional(),
});
