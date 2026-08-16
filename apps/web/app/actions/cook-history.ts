"use server";

import { db } from "@/lib/db";
import { cookHistory, recipes } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { uploadFile, isStorageAvailable } from "@/lib/storage";
import { makeThumbnail } from "@/lib/thumbnail";
import sharp from "sharp";
import { refreshTasteProfile } from "./taste-profile";

export type LogCookInput = {
  rating?: number | null;
  actualDuration?: number | null;
  notes?: string | null;
  occasion?: string | null;
  cookedFor?: string[] | null;
};

export async function logCook(
  recipeId: string,
  data: LogCookInput
): Promise<{ id: string }> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);
  if (!recipe) throw new Error("Recipe not found");

  const [row] = await db
    .insert(cookHistory)
    .values({
      householdId,
      recipeId,
      rating: data.rating != null ? String(data.rating) : null,
      actualDuration: data.actualDuration ?? null,
      notes: data.notes?.trim() || null,
      occasion: data.occasion?.trim() || null,
      cookedFor: data.cookedFor?.length ? data.cookedFor : null,
    })
    .returning({ id: cookHistory.id });

  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
  void refreshTasteProfile(householdId);
  return row!;
}

export async function rateCook(
  cookId: string,
  rating: number
): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [row] = await db
    .select({ recipeId: cookHistory.recipeId })
    .from(cookHistory)
    .where(
      and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, householdId))
    )
    .limit(1);

  if (!row) throw new Error("Cook history record not found");

  await db
    .update(cookHistory)
    .set({ rating: String(rating) })
    .where(and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, householdId)));

  revalidatePath(`/recipes/${row.recipeId}`);
  revalidatePath("/recipes");
  void refreshTasteProfile(householdId);
}

export async function rateRecipe(
  recipeId: string,
  rating: number,
  notes?: string
): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);

  if (!recipe) throw new Error("Recipe not found");

  // A rating given without cooking — kept out of the cook count.
  await db.insert(cookHistory).values({
    householdId,
    recipeId,
    rating: String(rating),
    notes: notes?.trim() || null,
    source: "rating",
  });

  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
  void refreshTasteProfile(householdId);
}

/**
 * Reads live in `lib/services/cook-history.ts` — pages and the v1 API call them
 * directly. They were duplicated here with the arguments in the opposite order,
 * which is how the recipe page ended up querying by (recipeId, householdId) and
 * showing no ratings, history, or photos at all. Don't reintroduce them.
 */

export type UpdateCookEntryInput = {
  rating?: number | null;
  notes?: string | null;
  occasion?: string | null;
};

export async function updateCookEntry(
  cookId: string,
  data: UpdateCookEntryInput
): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [row] = await db
    .select({ recipeId: cookHistory.recipeId })
    .from(cookHistory)
    .where(and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, householdId)))
    .limit(1);
  if (!row) throw new Error("Cook record not found");

  await db
    .update(cookHistory)
    .set({
      ...(data.rating !== undefined ? { rating: data.rating != null ? String(data.rating) : null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
      ...(data.occasion !== undefined ? { occasion: data.occasion?.trim() || null } : {}),
    })
    .where(and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, householdId)));

  revalidatePath(`/recipes/${row.recipeId}`);
  revalidatePath("/recipes");
  void refreshTasteProfile(householdId);
}

// Remove a single cook-history entry — for duplicates or a mis-logged cook.
// Deleting an entry also removes its rating from the recipe average.
export async function deleteCookEntry(cookId: string): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [row] = await db
    .select({ recipeId: cookHistory.recipeId })
    .from(cookHistory)
    .where(and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, householdId)))
    .limit(1);
  if (!row) throw new Error("Cook record not found");

  await db
    .delete(cookHistory)
    .where(and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, householdId)));

  revalidatePath(`/recipes/${row.recipeId}`);
  revalidatePath("/recipes");
  void refreshTasteProfile(householdId);
}

export async function uploadCookPhoto(
  cookId: string,
  formData: FormData
): Promise<{ url?: string; error?: string }> {
  if (!isStorageAvailable()) return { error: "Storage not configured." };

  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [row] = await db
    .select({ recipeId: cookHistory.recipeId })
    .from(cookHistory)
    .where(and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, householdId)))
    .limit(1);
  if (!row) return { error: "Cook record not found." };

  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return { error: "No photo provided." };
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { error: "Only JPEG, PNG, and WebP images are allowed." };
  if (file.size > 15 * 1024 * 1024) return { error: "Photo must be under 15 MB." };

  const raw = Buffer.from(await file.arrayBuffer());

  // Resize to max 1600 px wide and convert to JPEG before storing
  const resized = await sharp(raw)
    .rotate() // auto-rotate from EXIF orientation, then strip the tag
    .resize(1600, null, { withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  const key = `households/${householdId}/cook-history/${cookId}/dish.jpg`;

  const [url] = await Promise.all([
    uploadFile(key, resized, "image/jpeg"),
    makeThumbnail(raw).then((thumb) =>
      uploadFile(`households/${householdId}/cook-history/${cookId}/dish_thumb.jpg`, thumb, "image/jpeg")
    ).catch(() => null),
  ]);

  await db.update(cookHistory).set({ photoUrl: url }).where(and(eq(cookHistory.id, cookId), eq(cookHistory.householdId, householdId)));
  revalidatePath(`/recipes/${row.recipeId}`);

  return { url };
}
