"use server";

import { db } from "@/lib/db";
import { tasteProfiles } from "@dishes/db/schema";
import { revalidatePath } from "next/cache";
import { resolveIdentity } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

// Reads and the recompute live in lib/services/taste-profile.ts — they take a
// householdId, so they must not be exported from a "use server" module.

// ── clearTasteProfile (admin only) ────────────────────────────────────────────

export async function clearTasteProfile(): Promise<{ error?: string }> {
  const user = await resolveIdentity();
  const { householdId, role } = await requireHousehold(user);
  if (role !== "admin") return { error: "Only admins can reset the taste profile." };

  await db
    .insert(tasteProfiles)
    .values({
      householdId,
      cuisines: {},
      ingredients: {},
      tags: {},
      mealTypes: {},
      ratedCookCount: 0,
    })
    .onConflictDoUpdate({
      target: tasteProfiles.householdId,
      set: {
        cuisines: {},
        ingredients: {},
        tags: {},
        mealTypes: {},
        ratedCookCount: 0,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/settings/taste");
  return {};
}
