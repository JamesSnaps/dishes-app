import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { addAiGeneratedMealPlan } from "@/app/actions/meal-plan";
import { fromAction } from "../../respond";

const schema = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slots: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      mealType: z.string().max(20),
      title: z.string(),
      description: z.string(),
      cuisine: z.string(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      recipeId: z.string().uuid().nullable().optional(),
    })
  ).min(1).max(28),
  memberIds: z.array(z.string().uuid()).optional(),
  heartHealthy: z.boolean().optional(),
});

/**
 * POST — add a draft week to the plan. New ideas are written out as full
 * recipes first (slow: one AI call each). → `{ success: true }`
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const input = schema.parse(await req.json());
  const result = await addAiGeneratedMealPlan(input.weekStartDate, input.slots, input.memberIds ?? [], {
    heartHealthy: input.heartHealthy,
  });
  return fromAction({ success: result.success, error: result.error });
});
