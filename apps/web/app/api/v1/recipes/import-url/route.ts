import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { withApiErrors } from "@/lib/api/respond";
import { importRecipeFromUrl } from "@/app/actions/ai";
import * as recipeService from "@/lib/services/recipes";
import { isMealRole } from "@dishes/shared";
import type { RecipeFormDefaults } from "@/app/(app)/recipes/_components/recipe-form";
import { fromAction } from "../../ai/respond";

const schema = z.object({
  /** A recipe page link; the scheme may be left off. */
  url: z.string().trim().min(4).max(2048),
});

/** The web form's draft as a write: what the form would have saved untouched. */
function draftToWriteInput(d: RecipeFormDefaults): recipeService.RecipeWriteInput {
  return {
    fields: {
      title: d.title?.trim() || "Imported recipe",
      description: d.description || null,
      cuisine: d.cuisine || null,
      prepTimeMinutes: d.prepTimeMinutes ?? null,
      cookTimeMinutes: d.cookTimeMinutes ?? null,
      servings: d.servings || null,
      servingsUnit: d.servingsUnit || "servings",
      difficulty: d.difficulty ?? null,
      mealRole: isMealRole(d.mealRole) ? d.mealRole : null,
      mealTypes: recipeService.sanitizeMealTypes(d.mealTypes),
      sourceUrl: d.sourceUrl || null,
      notes: d.notes || null,
      imageUrl: d.imageUrl || null,
      thumbnailUrl: d.thumbnailUrl || null,
      ...recipeService.buildNutrition(d, "manual"),
    },
    ingredients: (d.ingredients ?? []).map((i) => ({
      ingredientName: i.ingredientName,
      amount: i.amount,
      unit: i.unit,
      preparation: i.preparation,
      isOptional: i.isOptional,
      groupLabel: i.groupLabel,
    })),
    steps: (d.steps ?? []).map((s) => ({
      instruction: s.instruction,
      durationMinutes: s.durationMinutes,
      timerLabel: s.timerLabel,
      groupLabel: s.groupLabel,
    })),
    tags: d.tags ?? [],
  };
}

/**
 * POST — a recipe page read in (as the web's New Recipe → Import from web)
 * and saved straight away; the app opens it once it syncs down, where it can
 * be edited. → `{ recipeId, title, via, notice? }` (201).
 */
export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const { url } = schema.parse(await req.json());
  const read = await importRecipeFromUrl(url);
  if (read.error || !read.draft) return fromAction({ error: read.error ?? "Couldn't import that page." });

  const { recipeId } = await recipeService.createRecipe(session, draftToWriteInput(read.draft));
  revalidatePath("/recipes");
  return NextResponse.json(
    { recipeId, title: read.draft.title ?? "", via: read.via, notice: read.notice ?? null },
    { status: 201 }
  );
});
