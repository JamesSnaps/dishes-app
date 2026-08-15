import { z } from "zod";
import { MEAL_TYPES } from "@dishes/shared";

/** Wire formats for /api/v1/meal-plan. */

const mealTypeSchema = z.enum(MEAL_TYPES);

/** `YYYY-MM-DD`, and specifically the Monday the week starts on. */
const weekStartSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "week must be YYYY-MM-DD");

export const weekQuerySchema = z.object({
  week: weekStartSchema,
});

export const addEntrySchema = z.object({
  weekStartDate: weekStartSchema,
  recipeId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  mealType: mealTypeSchema,
});

/**
 * At least one field must be present; each maps to a distinct service call, so
 * the route applies them in a fixed order rather than as one update.
 */
export const updateEntrySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    mealType: mealTypeSchema,
    servings: z.number().positive().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

export const generateWeekShoppingSchema = z.object({
  mealPlanId: z.string().uuid(),
  forceInclude: z.array(z.string()).optional(),
});

export const entryShoppingSchema = z
  .object({
    forceInclude: z.array(z.string()).optional(),
  })
  .default({});
