import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { generateConcepts } from "@/app/actions/ai";
import { fromAction } from "../respond";

const schema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  memberIds: z.array(z.string().uuid()).optional(),
  mealType: z.string().max(20).optional(),
  heartHealthy: z.boolean().optional(),
  mealRole: z.enum(["main", "side", "sauce", "other"]).optional(),
});

/**
 * POST — step one of the recipe concierge: five ideas for what was asked for,
 * shaped by the household's taste profile and the chosen members' diets.
 * → `{ concepts: [{ title, description, cuisine, tags, difficulty }] }`
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const input = schema.parse(await req.json());
  return fromAction(
    await generateConcepts(input.prompt, input.memberIds, input.mealType, undefined, {
      heartHealthy: input.heartHealthy,
      mealRole: input.mealRole,
    })
  );
});
