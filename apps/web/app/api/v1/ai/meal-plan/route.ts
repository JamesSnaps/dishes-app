import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { generateMealPlanConcepts } from "@/app/actions/ai";
import { fromAction } from "../respond";

const schema = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slots: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), mealType: z.string().max(20) })).min(1).max(28),
  preferences: z.string().max(2000).default(""),
  memberIds: z.array(z.string().uuid()).optional(),
  favouritesOnly: z.boolean().optional(),
  heartHealthy: z.boolean().optional(),
});

/**
 * POST — a draft week: for each slot, a recipe from the library or a new idea.
 * Nothing is saved; `POST /api/v1/ai/meal-plan/apply` adds the draft.
 * → `{ slots: [{ dayOfWeek, mealType, title, description, cuisine, difficulty, recipeId? }] }`
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const input = schema.parse(await req.json());
  return fromAction(await generateMealPlanConcepts(input));
});
