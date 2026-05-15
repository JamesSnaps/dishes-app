"use server";

import { db } from "@/lib/db";
import {
  households,
  householdMembers,
  aiConfigurations,
} from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { encrypt, decrypt } from "@/lib/crypto";

// ─── Household ────────────────────────────────────────────────────────────────

export async function updateHouseholdName(formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can update household settings");

  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Name is required");

  await db
    .update(households)
    .set({ name })
    .where(eq(households.id, householdId));

  revalidatePath("/settings");
}

// ─── Members ──────────────────────────────────────────────────────────────────

export async function addMember(formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can add members");

  const autheliaUser = (formData.get("autheliaUser") as string)?.trim().toLowerCase();
  const displayName = (formData.get("displayName") as string)?.trim();
  const memberRole = (formData.get("role") as "admin" | "adult" | "child") ?? "adult";

  if (!autheliaUser) throw new Error("Username is required");
  if (!displayName) throw new Error("Display name is required");

  // Check for existing active member
  const existing = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.autheliaUser, autheliaUser),
        eq(householdMembers.isActive, true)
      )
    )
    .limit(1);

  if (existing.length) throw new Error("That user is already a member");

  await db.insert(householdMembers).values({
    householdId,
    autheliaUser,
    displayName,
    role: memberRole,
  });

  revalidatePath("/settings");
}

export async function updateMemberRole(memberId: string, newRole: "admin" | "adult" | "child") {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can change roles");

  await db
    .update(householdMembers)
    .set({ role: newRole })
    .where(
      and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.householdId, householdId)
      )
    );

  revalidatePath("/settings");
}

export async function removeMember(memberId: string) {
  const user = await getAutheliaUser();
  const { householdId, memberId: currentMemberId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can remove members");
  if (memberId === currentMemberId) throw new Error("You cannot remove yourself");

  await db
    .update(householdMembers)
    .set({ isActive: false })
    .where(
      and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.householdId, householdId)
      )
    );

  revalidatePath("/settings");
}

export type MemberPreferencesInput = {
  dietaryFlags: string[];
  dislikes: string[];
  preferences: string[];
  customNotes: string;
};

export async function updateMemberPreferences(
  memberId: string,
  data: MemberPreferencesInput
): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  await db
    .update(householdMembers)
    .set({
      dietaryFlags: data.dietaryFlags.length ? data.dietaryFlags : null,
      dislikes: data.dislikes.length ? data.dislikes : null,
      preferences: data.preferences.length ? data.preferences : null,
      customNotes: data.customNotes.trim() || null,
    })
    .where(
      and(
        eq(householdMembers.id, memberId),
        eq(householdMembers.householdId, householdId)
      )
    );

  revalidatePath("/settings");
}

// ─── AI Config ────────────────────────────────────────────────────────────────

export async function saveAiConfig(formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can configure AI settings");

  const rawKey = (formData.get("apiKey") as string)?.trim();
  const model = (formData.get("model") as string)?.trim() || "gpt-4.1-nano";
  const imageModel = (formData.get("imageModel") as string)?.trim() || "gpt-image-2";
  const monthlyLimit = (formData.get("monthlyLimit") as string)?.trim() || "20.00";
  const defaultPrompt = (formData.get("defaultPrompt") as string)?.trim() || null;
  const kitchenEquipment = (formData.get("kitchenEquipment") as string)?.trim() || null;
  const measurementSystem = (formData.get("measurementSystem") as string)?.trim() || "metric";

  const existing = await db
    .select({ id: aiConfigurations.id, encryptedApiKey: aiConfigurations.encryptedApiKey })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);

  // If no new key was submitted, keep the existing one
  let encryptedApiKey: string;
  if (rawKey) {
    encryptedApiKey = encrypt(rawKey);
  } else if (existing[0]) {
    encryptedApiKey = existing[0].encryptedApiKey;
  } else {
    throw new Error("API key is required");
  }

  if (existing.length) {
    await db
      .update(aiConfigurations)
      .set({ encryptedApiKey, model, imageModel, monthlyLimitUsd: monthlyLimit, defaultPrompt, kitchenEquipment, measurementSystem })
      .where(eq(aiConfigurations.id, existing[0]!.id));
  } else {
    await db.insert(aiConfigurations).values({
      householdId,
      encryptedApiKey,
      model,
      imageModel,
      monthlyLimitUsd: monthlyLimit,
      defaultPrompt,
      kitchenEquipment,
      measurementSystem,
    });
  }

  revalidatePath("/settings/ai");
}

// ─── Read helpers (called from server components) ─────────────────────────────

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

export async function getAiConfig(householdId: string) {
  const [config] = await db
    .select({
      id: aiConfigurations.id,
      model: aiConfigurations.model,
      imageModel: aiConfigurations.imageModel,
      monthlyLimitUsd: aiConfigurations.monthlyLimitUsd,
      defaultPrompt: aiConfigurations.defaultPrompt,
      kitchenEquipment: aiConfigurations.kitchenEquipment,
      measurementSystem: aiConfigurations.measurementSystem,
      encryptedApiKey: aiConfigurations.encryptedApiKey,
    })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);

  if (!config) return null;

  // Reveal only that a key exists, not its value
  return {
    id: config.id,
    model: config.model,
    imageModel: config.imageModel,
    monthlyLimitUsd: config.monthlyLimitUsd,
    defaultPrompt: config.defaultPrompt,
    kitchenEquipment: config.kitchenEquipment,
    measurementSystem: config.measurementSystem,
    hasKey: true,
    // Short hint: first 8 chars only — enough to identify the key, won't overflow on mobile
    keyHint: (() => {
      try {
        const plain = decrypt(config.encryptedApiKey);
        return plain.length > 8 ? `${plain.slice(0, 8)}…` : plain.slice(0, 5) + "…";
      } catch {
        return "••••••••";
      }
    })(),
  };
}
