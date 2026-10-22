"use server";

import { db } from "@/lib/db";
import {
  households,
  householdMembers,
  aiConfigurations,
  appSettings,
} from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { isServerAdmin, resolveIdentity } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { encrypt } from "@/lib/crypto";

// ─── Household ────────────────────────────────────────────────────────────────

export async function updateHouseholdName(formData: FormData) {
  const user = await resolveIdentity();
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
  const user = await resolveIdentity();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can add members");

  const autheliaUser = (formData.get("autheliaUser") as string)?.trim().toLowerCase();
  const displayName = (formData.get("displayName") as string)?.trim();
  const memberRole = (formData.get("role") as "admin" | "adult" | "child") ?? "adult";
  const birthYear = parseBirthYear(formData.get("birthYear"));

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

  // Someone removed earlier keeps their row (isActive false); bring that back
  // rather than adding a second one for the same person.
  const [removed] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.autheliaUser, autheliaUser),
        eq(householdMembers.isActive, false)
      )
    )
    .limit(1);

  if (removed) {
    await db
      .update(householdMembers)
      .set({ isActive: true, displayName, role: memberRole, birthYear, updatedAt: new Date() })
      .where(eq(householdMembers.id, removed.id));
  } else {
    await db.insert(householdMembers).values({
      householdId,
      autheliaUser,
      displayName,
      role: memberRole,
      birthYear,
    });
  }

  revalidatePath("/settings");
}

// Parse an optional birth year from form/user input. Returns null when blank
// or implausible so we never store junk that would mislead the AI.
function parseBirthYear(raw: FormDataEntryValue | null | undefined): number | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  const year = Number.parseInt(value, 10);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(year) || year < 1900 || year > currentYear) return null;
  return year;
}

export async function updateMemberRole(memberId: string, newRole: "admin" | "adult" | "child") {
  const user = await resolveIdentity();
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
  const user = await resolveIdentity();
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
  role: "admin" | "adult" | "child";
  birthYear: number | null;
  dietaryFlags: string[];
  dislikes: string[];
  preferences: string[];
  customNotes: string;
};

export async function updateMemberPreferences(
  memberId: string,
  data: MemberPreferencesInput
): Promise<void> {
  const user = await resolveIdentity();
  const { householdId, memberId: ownId, role: ownRole } = await requireHousehold(user);

  // Anyone can set their own diet and preferences; only admins can change
  // someone else's, or anyone's role (without this a member could make
  // themselves an admin).
  const isAdmin = ownRole === "admin";
  if (!isAdmin && memberId !== ownId) throw new Error("Only admins can change other members");
  const [current] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.id, memberId), eq(householdMembers.householdId, householdId)))
    .limit(1);
  if (!current) throw new Error("Member not found");

  await db
    .update(householdMembers)
    .set({
      role: isAdmin ? data.role : current.role,
      birthYear: parseBirthYear(data.birthYear == null ? null : String(data.birthYear)),
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
  const user = await resolveIdentity();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can configure AI settings");

  const rawKey = (formData.get("apiKey") as string)?.trim();
  const model = (formData.get("model") as string)?.trim() || "gpt-4.1-nano";
  const imageModel = (formData.get("imageModel") as string)?.trim() || "gpt-image-2";
  const monthlyLimit = (formData.get("monthlyLimit") as string)?.trim() || "20.00";
  const defaultPrompt = (formData.get("defaultPrompt") as string)?.trim() || null;
  const kitchenEquipment = (formData.get("kitchenEquipment") as string)?.trim() || null;
  const measurementSystem = (formData.get("measurementSystem") as string)?.trim() || "metric";
  const imageStyle = (formData.get("imageStyle") as string)?.trim() || "studio";
  const webGrounding = formData.get("webGrounding") === "on";

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
      .set({ encryptedApiKey, model, imageModel, monthlyLimitUsd: monthlyLimit, defaultPrompt, kitchenEquipment, measurementSystem, imageStyle, webGrounding })
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
      imageStyle,
      webGrounding,
    });
  }

  revalidatePath("/settings/ai");
}

// Household/member and AI config reads live in lib/services/household-settings.ts:
// they take a householdId, so they must not be exported from a "use server" module.

// ─── App settings (global, not household-scoped) ─────────────────────────────

import type { LogLevel } from "@/lib/log-levels";

export async function getLogLevel(): Promise<LogLevel> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "log_level"))
    .limit(1);
  return (row?.value as LogLevel) ?? "info";
}

export async function setLogLevel(level: LogLevel): Promise<void> {
  const user = await resolveIdentity();
  const { role } = await requireHousehold(user);
  if (role !== "admin" || !isServerAdmin(user)) throw new Error("Server admins only");

  await db
    .insert(appSettings)
    .values({ key: "log_level", value: level })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: level, updatedAt: new Date() },
    });

  revalidatePath("/settings");
}
