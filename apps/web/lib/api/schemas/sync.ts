import { z } from "zod";
import { MEAL_ROLES, MEAL_TYPES } from "@dishes/shared";

/** Wire formats for /api/v1/sync. */

export const pullQuerySchema = z.object({
  /** Omit for a full snapshot — a first run, or a wiped local store. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

const opId = z.string().uuid();
const weekStartDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dayOfWeek = z.number().int().min(0).max(6);
const mealRole = z.enum(MEAL_ROLES);
const groupTitle = z.string().trim().min(1).max(200);

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
        /** Where it sits in the list (the app's drag to reorder). */
        position: z.number().int().min(0).optional(),
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
      weekStartDate,
      recipeId: z.string().uuid(),
      dayOfWeek,
      mealType: z.enum(MEAL_TYPES),
      /** Add as part of this planned meal; the meal's slot wins. */
      groupId: z.string().uuid().optional(),
      mealRole: mealRole.optional(),
    }),
  }),
  z.object({
    opId,
    type: z.literal("meal_plan_entry.update"),
    payload: z
      .object({
        entryId: z.string().uuid(),
        dayOfWeek: dayOfWeek.optional(),
        weekStartDate: weekStartDate.optional(),
        mealType: z.enum(MEAL_TYPES).optional(),
        servings: z.number().positive().nullable().optional(),
        /** Swap the recipe in place, keeping slot, meal and role. */
        recipeId: z.string().uuid().optional(),
        /** Join a planned meal, or null to take the entry out of its meal. */
        groupId: z.string().uuid().nullable().optional(),
        mealRole: mealRole.optional(),
      })
      .refine((v) => Object.keys(v).length > 1, "No fields to update")
      .refine(
        (v) => v.weekStartDate === undefined || v.dayOfWeek !== undefined,
        "weekStartDate requires dayOfWeek"
      ),
  }),
  z.object({
    opId,
    type: z.literal("meal_plan_entry.delete"),
    payload: z.object({ entryId: z.string().uuid() }),
  }),
  z.object({
    opId,
    type: z.literal("meal_plan_group.add"),
    payload: z
      .object({
        weekStartDate,
        title: groupTitle,
        dayOfWeek,
        mealType: z.enum(MEAL_TYPES),
        sourceMealId: z.string().uuid().nullable().optional(),
        servings: z.number().positive().nullable().optional(),
        components: z
          .array(z.object({ recipeId: z.string().uuid(), role: mealRole }))
          .max(20)
          .optional(),
        entries: z
          .array(z.object({ entryId: z.string().uuid(), role: mealRole }))
          .max(20)
          .optional(),
        /** Remember the chosen dishes as the saved meal's defaults. */
        rememberChoices: z.boolean().optional(),
      })
      .refine(
        (v) => (v.components?.length ?? 0) + (v.entries?.length ?? 0) > 0,
        "A meal needs at least one recipe"
      ),
  }),
  z.object({
    opId,
    type: z.literal("meal_plan_group.add_from_meal"),
    payload: z.object({
      mealId: z.string().uuid(),
      weekStartDate,
      dayOfWeek,
      /** Defaults to the saved meal's own meal type. */
      mealType: z.enum(MEAL_TYPES).optional(),
      /** Chosen options across all slots; omit for each slot's defaults. */
      optionIds: z.array(z.string().uuid()).max(50).optional(),
      servings: z.number().positive().nullable().optional(),
    }),
  }),
  z.object({
    opId,
    type: z.literal("meal_plan_group.update"),
    payload: z
      .object({
        groupId: z.string().uuid(),
        title: groupTitle.optional(),
        dayOfWeek: dayOfWeek.optional(),
        mealType: z.enum(MEAL_TYPES).optional(),
        servings: z.number().positive().nullable().optional(),
      })
      .refine((v) => Object.keys(v).length > 1, "No fields to update"),
  }),
  z.object({
    opId,
    type: z.literal("meal_plan_group.delete"),
    payload: z.object({
      groupId: z.string().uuid(),
      /** Ungroup: keep the recipes on the plan as separate meals. */
      keepRecipes: z.boolean().optional(),
    }),
  }),
]);

export const pushBodySchema = z.object({
  /** Applied in array order; the client's queue order is the intended order. */
  mutations: z.array(mutationSchema).min(1).max(200),
});
