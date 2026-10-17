/**
 * Household settings reads: the household and its members, and the AI config.
 *
 * Not a "use server" module. These take the caller's household context, so
 * only server code that has already resolved the caller's membership (pages,
 * the v1 actions route) may call them — never with a client-supplied id.
 */

import { db } from "@/lib/db";
import { households, householdMembers, aiConfigurations } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import type { PrivilegedContext } from "@/lib/session";

export async function getHouseholdWithMembers(householdId: string) {
  const [household] = await db
    .select({ id: households.id, name: households.name, slug: households.slug })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);

  const members = await db
    .select({
      id: householdMembers.id,
      autheliaUser: householdMembers.autheliaUser,
      displayName: householdMembers.displayName,
      role: householdMembers.role,
      birthYear: householdMembers.birthYear,
      avatarUrl: householdMembers.avatarUrl,
      dietaryFlags: householdMembers.dietaryFlags,
      dislikes: householdMembers.dislikes,
      preferences: householdMembers.preferences,
      customNotes: householdMembers.customNotes,
      createdAt: householdMembers.createdAt,
    })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.isActive, true)
      )
    )
    .orderBy(householdMembers.createdAt);

  return { household: household!, members };
}

/**
 * The household's AI settings. Everyone in the household may see the model,
 * style and prompt settings (iOS shows them read-only to non-admins, and the
 * recipe pages need `hasKey` / `imageStyle`); only admins get `keyHint`, a
 * short prefix of the key. The key itself never leaves the server.
 */
export async function getAiConfig(ctx: Pick<PrivilegedContext, "householdId" | "role">) {
  const [config] = await db
    .select({
      id: aiConfigurations.id,
      model: aiConfigurations.model,
      imageModel: aiConfigurations.imageModel,
      monthlyLimitUsd: aiConfigurations.monthlyLimitUsd,
      defaultPrompt: aiConfigurations.defaultPrompt,
      kitchenEquipment: aiConfigurations.kitchenEquipment,
      measurementSystem: aiConfigurations.measurementSystem,
      imageStyle: aiConfigurations.imageStyle,
      webGrounding: aiConfigurations.webGrounding,
      encryptedApiKey: aiConfigurations.encryptedApiKey,
    })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, ctx.householdId))
    .limit(1);

  if (!config) return null;

  return {
    id: config.id,
    model: config.model,
    imageModel: config.imageModel,
    monthlyLimitUsd: config.monthlyLimitUsd,
    defaultPrompt: config.defaultPrompt,
    kitchenEquipment: config.kitchenEquipment,
    measurementSystem: config.measurementSystem,
    imageStyle: config.imageStyle,
    webGrounding: config.webGrounding,
    hasKey: true,
    // Admins only: first 8 chars — enough to identify the key, won't overflow on mobile.
    keyHint: ctx.role === "admin" ? keyHint(config.encryptedApiKey) : null,
  };
}

function keyHint(encryptedApiKey: string): string {
  try {
    const plain = decrypt(encryptedApiKey);
    return plain.length > 8 ? `${plain.slice(0, 8)}…` : plain.slice(0, 5) + "…";
  } catch {
    return "••••••••";
  }
}
