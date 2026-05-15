import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { getRedis } from "@/lib/redis";
import { uploadFile, isStorageAvailable } from "@/lib/storage";
import { db } from "@/lib/db";
import { recipes, recipeIngredients, recipeSteps, recipeTags } from "@dishes/db/schema";
import { revalidatePath } from "next/cache";
import type { ParsedCrumbRecipe } from "@/lib/crumb-parser";

interface ImportRequest {
  sessionId: string | null;
  selectedIndices: number[];
  /** Supplied by client when Redis is unavailable (sessionId === null) */
  fullData?: ParsedCrumbRecipe[];
}

async function uploadImageIfAvailable(
  imageBase64: string | null,
  householdId: string
): Promise<string | null> {
  if (!imageBase64 || !isStorageAvailable()) return null;
  try {
    const buf = Buffer.from(imageBase64, "base64");
    const key = `recipes/${householdId}/${randomUUID()}.jpg`;
    return await uploadFile(key, buf, "image/jpeg");
  } catch {
    return null;
  }
}

async function createRecipeFromParsed(
  parsed: ParsedCrumbRecipe,
  householdId: string,
  memberId: string
): Promise<string> {
  const imageUrl = await uploadImageIfAvailable(parsed.imageBase64, householdId);

  const [recipe] = await db
    .insert(recipes)
    .values({
      householdId,
      createdById: memberId,
      title: parsed.title,
      sourceUrl: parsed.sourceUrl,
      prepTimeMinutes: parsed.prepTimeMinutes,
      cookTimeMinutes: parsed.cookTimeMinutes,
      servings: parsed.servings,
      servingsUnit: "servings",
      notes: parsed.notes,
      imageUrl,
      isAiGenerated: false,
    })
    .returning({ id: recipes.id });

  const recipeId = recipe!.id;

  await Promise.all([
    parsed.ingredients.length
      ? db.insert(recipeIngredients).values(
          parsed.ingredients.map((ing, i) => ({
            recipeId,
            position: i,
            ingredientName: ing.ingredientName,
            amount: ing.amount || null,
            unit: ing.unit || null,
            preparation: ing.preparation || null,
            isOptional: ing.isOptional,
            groupLabel: ing.groupLabel || null,
          }))
        )
      : Promise.resolve(),
    parsed.steps.length
      ? db.insert(recipeSteps).values(
          parsed.steps.map((s, i) => ({
            recipeId,
            position: i,
            instruction: s.instruction,
            durationMinutes: s.durationMinutes ? parseInt(s.durationMinutes) : null,
            timerLabel: s.timerLabel || null,
          }))
        )
      : Promise.resolve(),
    parsed.tags.length
      ? db.insert(recipeTags).values(parsed.tags.map((tag) => ({ recipeId, tag })))
      : Promise.resolve(),
  ]);

  return recipeId;
}

export async function POST(req: NextRequest) {
  const user = await getAutheliaUser();
  const { householdId, memberId } = await requireHousehold(user);

  const body: ImportRequest = await req.json();
  const { sessionId, selectedIndices, fullData } = body;

  if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) {
    return NextResponse.json({ error: "No recipes selected" }, { status: 400 });
  }

  let allParsed: ParsedCrumbRecipe[];

  if (sessionId) {
    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({ error: "Redis unavailable" }, { status: 503 });
    }
    const stored = await redis.get(`crumb-import:${sessionId}`);
    if (!stored) {
      return NextResponse.json({ error: "Session expired — please re-upload the file" }, { status: 410 });
    }
    allParsed = JSON.parse(stored) as ParsedCrumbRecipe[];
  } else if (fullData) {
    allParsed = fullData;
  } else {
    return NextResponse.json({ error: "No session or recipe data provided" }, { status: 400 });
  }

  const selected = selectedIndices
    .map((i) => allParsed[i])
    .filter((r): r is ParsedCrumbRecipe => r != null);

  if (selected.length === 0) {
    return NextResponse.json({ error: "No valid recipes at selected indices" }, { status: 400 });
  }

  const imported: { id: string; title: string }[] = [];
  const errors: string[] = [];

  for (const parsed of selected) {
    try {
      const id = await createRecipeFromParsed(parsed, householdId, memberId);
      imported.push({ id, title: parsed.title });
    } catch (err) {
      errors.push(`${parsed.title}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  revalidatePath("/recipes");

  // Clean up Redis session on full success
  if (sessionId && errors.length === 0) {
    const redis = getRedis();
    redis?.del(`crumb-import:${sessionId}`).catch(() => null);
  }

  return NextResponse.json({ imported, errors });
}
