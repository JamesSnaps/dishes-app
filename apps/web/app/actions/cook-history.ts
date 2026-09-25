"use server";

import { db } from "@/lib/db";
import { cookHistory } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { uploadFile, isStorageAvailable } from "@/lib/storage";
import { makeThumbnail } from "@/lib/thumbnail";
import sharp from "sharp";
import { refreshTasteProfile } from "./taste-profile";
import * as cookService from "@/lib/services/cook-history";


export async function logCook(
  recipeId: string,
  data: cookService.LogCookInput
): Promise<{ id: string }> {
  const user = await getAutheliaUser();
  const ctx = await requireHousehold(user);
  const { id } = await cookService.logCook(ctx, recipeId, data);
  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
  return { id };
}

export async function rateCook(cookId: string, rating: number): Promise<void> {
  const user = await getAutheliaUser();
  const ctx = await requireHousehold(user);
  const { recipeId } = await cookService.rateCook(ctx, cookId, rating);
  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
}

export async function rateRecipe(recipeId: string, rating: number, notes?: string): Promise<void> {
  const user = await getAutheliaUser();
  const ctx = await requireHousehold(user);
  await cookService.rateRecipe(ctx, recipeId, rating, notes);
  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
}

/**
 * Reads live in `lib/services/cook-history.ts` — pages and the v1 API call them
 * directly. They were duplicated here with the arguments in the opposite order,
 * which is how the recipe page ended up querying by (recipeId, householdId) and
 * showing no ratings, history, or photos at all. Don't reintroduce them.
 */

export async function updateCookEntry(
  cookId: string,
  data: cookService.UpdateCookEntryInput
): Promise<void> {
  const user = await getAutheliaUser();
  const ctx = await requireHousehold(user);
  const { recipeId } = await cookService.updateCookEntry(ctx, cookId, data);
  revalidatePath(`/recipes/${recipeId}`);
  revalidatePath("/recipes");
  revalidatePath("/memories");
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
