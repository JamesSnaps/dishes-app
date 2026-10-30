import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { ndjsonResponse, wantsNdjson } from "@/lib/api/ndjson";
import { generateFullRecipe } from "@/app/actions/ai";
import type { RecipeEvent } from "@/lib/ai/job-types";
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
 *
 * With `Accept: application/x-ndjson` it streams one event per line as it
 * writes: `progress` (`stage` — grounding, ingredients, method or nutrition —
 * with the `ingredients` named so far, the `steps` count, and `revising` on a
 * heart-healthy second pass), then `done` with the saved recipe, or `error`.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const input = schema.parse(await req.json());
  if (!wantsNdjson(req)) {
    const generated = await generateFullRecipe(input.concept, input.memberIds, input.mealType, undefined, {
      heartHealthy: input.heartHealthy,
    });
    if (generated.error || !generated.recipe) return fromAction({ error: generated.error ?? "No recipe came back." });
    const saved = await saveGeneratedRecipe(generated.recipe);
    return fromAction({ ...saved, title: generated.recipe.title }, 201);
  }

  return ndjsonResponse<RecipeEvent>(async (emit) => {
    const generated = await generateFullRecipe(
      input.concept,
      input.memberIds,
      input.mealType,
      undefined,
      { heartHealthy: input.heartHealthy },
      (p) => emit({ type: "progress", ...p })
    );
    if (generated.error || !generated.recipe) {
      emit({ type: "error", message: generated.error ?? "No recipe came back." });
      return;
    }
    const saved = await saveGeneratedRecipe(generated.recipe);
    if (saved.error || !saved.recipeId) {
      emit({ type: "error", message: saved.error ?? "Couldn’t save the recipe." });
      return;
    }
    emit({ type: "done", recipeId: saved.recipeId, title: generated.recipe.title, collectionName: saved.collectionName });
  });
});
