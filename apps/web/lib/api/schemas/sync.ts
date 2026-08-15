import { z } from "zod";
import { MEAL_TYPES } from "@dishes/shared";

/** Wire formats for /api/v1/sync. */

export const pullQuerySchema = z.object({
  /** Omit for a full snapshot — a first run, or a wiped local store. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

const opId = z.string().uuid();

/**
 * Discriminated on `type` so each mutation validates its own payload shape and
 * an unknown type is rejected at the edge rather than falling through the
 * service switch.
 */
export const mutationSchema = z.discriminatedUnion("type", [
  z.object({
    opId,
    type: z.literal("shopping_item.add"),
    payload: z.object({
      ingredientName: z.string().min(1),
      amount: z.string().nullable().optional(),
      unit: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      id: z.string().uuid().optional(),
      listId: z.string().uuid().optional(),
      position: z.number().int().nonnegative().optional(),
    }),
  }),
  z.object({
    opId,
    type: z.literal("shopping_item.update"),
    payload: z
      .object({
        itemId: z.string().uuid(),
        ingredientName: z.string().min(1).optional(),
        amount: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
      })
      .refine((v) => Object.keys(v).length > 1, "No fields to update"),
  }),
  z.object({
    opId,
    type: z.literal("shopping_item.toggle"),
    payload: z.object({ itemId: z.string().uuid(), checked: z.boolean() }),
  }),
  z.object({
    opId,
    type: z.literal("shopping_item.delete"),
    payload: z.object({ itemId: z.string().uuid() }),
  }),
  z.object({
    opId,
    type: z.literal("shopping_list.clear_checked"),
    payload: z.object({ listId: z.string().uuid() }),
  }),
  z.object({
    opId,
    type: z.literal("meal_plan_entry.add"),
    payload: z.object({
      weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      recipeId: z.string().uuid(),
      dayOfWeek: z.number().int().min(0).max(6),
      mealType: z.enum(MEAL_TYPES),
    }),
  }),
  z.object({
    opId,
    type: z.literal("meal_plan_entry.update"),
    payload: z
      .object({
        entryId: z.string().uuid(),
        dayOfWeek: z.number().int().min(0).max(6).optional(),
        mealType: z.enum(MEAL_TYPES).optional(),
        servings: z.number().positive().nullable().optional(),
      })
      .refine((v) => Object.keys(v).length > 1, "No fields to update"),
  }),
  z.object({
    opId,
    type: z.literal("meal_plan_entry.delete"),
    payload: z.object({ entryId: z.string().uuid() }),
  }),
]);

export const pushBodySchema = z.object({
  /** Applied in array order; the client's queue order is the intended order. */
  mutations: z.array(mutationSchema).min(1).max(200),
});
