"use server";

import { db } from "@/lib/db";
import { integrationTokens } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { generateToken } from "@/lib/integration-auth";

export const ALL_SCOPES = [
  "read:meal_plan",
  "write:meal_plan",
  "read:shopping_list",
  "write:shopping_list",
] as const;

export type TokenScope = (typeof ALL_SCOPES)[number];

export async function createIntegrationToken(formData: FormData) {
  const user = await getAutheliaUser();
  const { householdId, memberId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can create integration tokens");

  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Token name is required");

  const scopes = ALL_SCOPES.filter((s) => formData.get(s) === "on");
  if (scopes.length === 0) throw new Error("Select at least one scope");

  const expiresInDays = parseInt(formData.get("expiresInDays") as string, 10) || 0;
  const expiresAt = expiresInDays > 0
    ? new Date(Date.now() + expiresInDays * 86_400_000)
    : null;

  const { raw, hash } = generateToken();

  await db.insert(integrationTokens).values({
    householdId,
    createdById: memberId,
    name,
    tokenHash: hash,
    scopes,
    expiresAt,
  });

  revalidatePath("/settings/integrations");

  // Return the raw token once — it cannot be recovered after this
  return { rawToken: raw };
}

export async function revokeIntegrationToken(tokenId: string) {
  const user = await getAutheliaUser();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can revoke tokens");

  await db
    .delete(integrationTokens)
    .where(
      and(
        eq(integrationTokens.id, tokenId),
        eq(integrationTokens.householdId, householdId)
      )
    );

  revalidatePath("/settings/integrations");
}

export async function listIntegrationTokens(householdId: string) {
  return db
    .select({
      id: integrationTokens.id,
      name: integrationTokens.name,
      scopes: integrationTokens.scopes,
      lastUsedAt: integrationTokens.lastUsedAt,
      expiresAt: integrationTokens.expiresAt,
      createdAt: integrationTokens.createdAt,
    })
    .from(integrationTokens)
    .where(eq(integrationTokens.householdId, householdId))
    .orderBy(integrationTokens.createdAt);
}
