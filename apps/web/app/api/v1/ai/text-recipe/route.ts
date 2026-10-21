import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { analyzeRecipeText } from "@/app/actions/ai";
import { saveGeneratedRecipe } from "@/app/actions/recipes";
import { fromAction } from "../respond";

const schema = z.object({
  /** A recipe as text: from a message, notes, a caption. */
  text: z.string().min(20).max(30_000),
});

/**
 * POST — text that holds a recipe, read and saved, as photo-recipe does for a
 * photo. → `{ recipeId, title, collectionName? }` (201). The iOS share sheet
 * reads shared text on the device first and comes here when it can't.
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const { text } = schema.parse(await req.json());
  const read = await analyzeRecipeText(text);
  if (read.error || !read.recipe) return fromAction({ error: read.error ?? "Couldn't find a recipe in that text." });
  const saved = await saveGeneratedRecipe(read.recipe);
  return fromAction({ ...saved, title: read.recipe.title }, 201);
});
