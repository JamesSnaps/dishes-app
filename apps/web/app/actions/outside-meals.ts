"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import type { OutsideMealView } from "@/lib/outside-meals";
import * as service from "@/lib/services/outside-meals";

// Everything that shows outside meals: the planner (day chips, nutrition
// card), Stats and Wrapped.
function revalidate() {
  revalidatePath("/meal-plan");
  revalidatePath("/stats");
  revalidatePath("/wrapped");
}

/** Validation problems come back as `error` for the form; anything else throws. */
async function attempt<T>(fn: () => Promise<T>): Promise<{ result?: T; error?: string }> {
  try {
    return { result: await fn() };
  } catch (err) {
    if (err instanceof service.OutsideMealValidationError || err instanceof service.OutsideMealNotFoundError) {
      return { error: err.message };
    }
    throw err;
  }
}

export async function createOutsideMeal(
  input: service.OutsideMealInput
): Promise<{ meal?: OutsideMealView; error?: string }> {
  const ctx = await requireSession();
  const { result, error } = await attempt(() => service.createOutsideMeal(ctx, input));
  if (result) revalidate();
  return { meal: result, error };
}

export async function updateOutsideMeal(
  id: string,
  input: service.UpdateOutsideMealInput
): Promise<{ meal?: OutsideMealView; staleEstimate?: boolean; error?: string }> {
  const ctx = await requireSession();
  const { result, error } = await attempt(() => service.updateOutsideMeal(ctx, id, input));
  if (result) revalidate();
  return { meal: result?.meal, staleEstimate: result?.staleEstimate, error };
}

export async function deleteOutsideMeal(id: string): Promise<{ error?: string }> {
  const ctx = await requireSession();
  const { error } = await attempt(() => service.deleteOutsideMeal(ctx, id));
  if (!error) revalidate();
  return { error };
}

/** `photo` in the form data; `slot` is the plate, the menu, or a course (`courseId`). */
export async function uploadOutsideMealPhoto(
  id: string,
  slot: service.PhotoSlot,
  formData: FormData,
  courseId?: string
): Promise<{ url?: string; error?: string }> {
  const ctx = await requireSession();
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "No photo provided." };
  const raw = Buffer.from(await file.arrayBuffer());
  const { result, error } = await attempt(() => service.setOutsideMealPhoto(ctx, id, slot, raw, file.type, courseId));
  if (result) revalidate();
  return { url: result?.url, error };
}

/** Waits for the AI — the log sheet shows "Estimating…" meanwhile. */
export async function estimateOutsideMeal(id: string): Promise<{ meal?: OutsideMealView; error?: string }> {
  const ctx = await requireSession();
  const { result, error } = await attempt(() => service.estimateOutsideMealNutrition(ctx, id));
  if (result) revalidate();
  return { meal: result, error };
}
