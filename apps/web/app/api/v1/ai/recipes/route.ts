import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { generateFullRecipe } from "@/app/actions/ai";
import { saveGeneratedRecipe } from "@/app/actions/recipes";
import { fromAction } from "../respond";

const schema = z.object({
  concept: z.object({
    title: z.string().min(1),
    description: z.string(),
    cuisine: z.string(),
    tags: z.array(z.string()),
    difficulty: z.enum(["easy", "medium", "hard"]),
  }),
  memberIds: z.array(z.string().uuid()).optional(),
  mealType: z.string().max(20).optional(),
  heartHealthy: z.boolean().optional(),
});

/**
 * POST — step two: write the chosen idea out in full and save it to the
 * household's recipes (filed into a collection when one clearly fits), as the
 * web concierge does. → `{ recipeId, title, collectionName? }` (201). The
 * recipe reaches the app through the next sync.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const input = schema.parse(await req.json());
  const generated = await generateFullRecipe(input.concept, input.memberIds, input.mealType, undefined, {
    heartHealthy: input.heartHealthy,
  });
  if (generated.error || !generated.recipe) return fromAction({ error: generated.error ?? "No recipe came back." });
  const saved = await saveGeneratedRecipe(generated.recipe);
  return fromAction({ ...saved, title: generated.recipe.title }, 201);
});
