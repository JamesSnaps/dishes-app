import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { analyzeRecipePhoto } from "@/app/actions/ai";
import { saveGeneratedRecipe } from "@/app/actions/recipes";
import { fromAction } from "../respond";

const schema = z.object({
  /** Base64 JPEG/PNG/HEIC, no data: prefix. ~8 MB of base64 at most. */
  image: z.string().min(100).max(11_000_000),
  mimeType: z.enum(["image/jpeg", "image/png", "image/heic", "image/webp"]).default("image/jpeg"),
});

/**
 * POST — a photo of a cookbook page, recipe card or screenshot, read into a
 * structured recipe and saved. → `{ recipeId, title }` (201).
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  await requireSession();
  const input = schema.parse(await req.json());
  const read = await analyzeRecipePhoto(input.image, input.mimeType);
  if (read.error || !read.recipe) return fromAction({ error: read.error ?? "Couldn't read a recipe from that photo." });
  const saved = await saveGeneratedRecipe(read.recipe);
  return fromAction({ ...saved, title: read.recipe.title }, 201);
});
