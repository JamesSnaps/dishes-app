/**
 * The household's AI prompt inputs, without the key: what the iOS app needs to
 * write the same prompts on the device that the server writes with
 * `buildSystemAddendum`, `buildMemberConstraints` and the taste-profile
 * addendum in `app/actions/ai.ts` (TODO_MOBILE.md, Phase D0).
 *
 * Readable by any member — the key, model and budget stay behind the
 * admin-only `ai.config` action.
 */

import { and, asc, eq } from "drizzle-orm";
import { aiConfigurations, collections, householdMembers, tasteProfiles } from "@dishes/db/schema";
import { db } from "@/lib/db";
import type { HouseholdContext } from "@/lib/session";
import { summariseTasteProfile, type TasteProfileSummary } from "@/lib/ai/taste-summary";

export type AiContextMember = {
  id: string;
  displayName: string;
  role: string;
  birthYear: number | null;
  dietaryFlags: string[];
  dislikes: string[];
  preferences: string[];
  customNotes: string | null;
};

export type AiContext = {
  /** Whether the household has a key, i.e. whether the server fallback can run. */
  configured: boolean;
  measurementSystem: string;
  defaultPrompt: string | null;
  kitchenEquipment: string | null;
  webGrounding: boolean;
  members: AiContextMember[];
  tasteProfile: TasteProfileSummary | null;
  collections: Array<{ id: string; name: string; description: string | null }>;
};

export async function getAiContext(ctx: Pick<HouseholdContext, "householdId">): Promise<AiContext> {
  const [configRows, memberRows, profileRows, collectionRows] = await Promise.all([
    db
      .select({
        defaultPrompt: aiConfigurations.defaultPrompt,
        kitchenEquipment: aiConfigurations.kitchenEquipment,
        measurementSystem: aiConfigurations.measurementSystem,
        webGrounding: aiConfigurations.webGrounding,
      })
      .from(aiConfigurations)
      .where(eq(aiConfigurations.householdId, ctx.householdId))
      .limit(1),
    db
      .select({
        id: householdMembers.id,
        displayName: householdMembers.displayName,
        role: householdMembers.role,
        birthYear: householdMembers.birthYear,
        dietaryFlags: householdMembers.dietaryFlags,
        dislikes: householdMembers.dislikes,
        preferences: householdMembers.preferences,
        customNotes: householdMembers.customNotes,
      })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.isActive, true)))
      .orderBy(asc(householdMembers.displayName)),
    db
      .select({
        cuisines: tasteProfiles.cuisines,
        ingredients: tasteProfiles.ingredients,
        ratedCookCount: tasteProfiles.ratedCookCount,
      })
      .from(tasteProfiles)
      .where(eq(tasteProfiles.householdId, ctx.householdId))
      .limit(1),
    db
      .select({ id: collections.id, name: collections.name, description: collections.description })
      .from(collections)
      .where(eq(collections.householdId, ctx.householdId))
      .orderBy(asc(collections.name)),
  ]);

  const [config] = configRows;
  const [profile] = profileRows;

  return {
    configured: !!config,
    // The column defaults, so an unconfigured household still gets metric on the device.
    measurementSystem: config?.measurementSystem ?? "metric",
    defaultPrompt: config?.defaultPrompt ?? null,
    kitchenEquipment: config?.kitchenEquipment ?? null,
    webGrounding: config?.webGrounding ?? false,
    members: memberRows.map((m) => ({
      ...m,
      dietaryFlags: m.dietaryFlags ?? [],
      dislikes: m.dislikes ?? [],
      preferences: m.preferences ?? [],
    })),
    tasteProfile: summariseTasteProfile(profile ?? null),
    collections: collectionRows,
  };
}
