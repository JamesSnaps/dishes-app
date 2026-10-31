"use server";

import { db } from "@/lib/db";
import { householdMembers, integrationTokens } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { resolveIdentity } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import { generateToken } from "@/lib/integration-auth";
// Note: a "use server" module may only export async functions — no type
// re-exports. Import TokenScope from "./integration-constants" directly.
import { ALL_SCOPES, MEMBER_SCOPES } from "./integration-constants";

/**
 * The name, scopes and member a create or edit form asks for, checked: at least
 * one scope, and a member of this household when a scope needs one.
 */
async function readTokenForm(formData: FormData, householdId: string) {
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Token name is required");

  const scopes = ALL_SCOPES.filter((s) => formData.get(s) === "on");
  if (scopes.length === 0) throw new Error("Select at least one scope");

  // Who the token acts as: needed for writes that belong to someone.
  const actsAs = ((formData.get("memberId") as string | null) ?? "").trim() || null;
  if (actsAs) {
    const [member] = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.id, actsAs),
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.isActive, true)
        )
      )
      .limit(1);
    if (!member) throw new Error("That member isn't in this household");
  } else if (scopes.some((s) => MEMBER_SCOPES.includes(s))) {
    throw new Error("Choose who the token acts as — logging meals out needs a member");
  }

  return { name, scopes, actsAs };
}

export async function createIntegrationToken(formData: FormData) {
  const user = await resolveIdentity();
  const { householdId, memberId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can create integration tokens");

  const { name, scopes, actsAs } = await readTokenForm(formData, householdId);

  const expiresInDays = parseInt(formData.get("expiresInDays") as string, 10) || 0;
  const expiresAt = expiresInDays > 0
    ? new Date(Date.now() + expiresInDays * 86_400_000)
    : null;

  const { raw, hash } = generateToken();

  await db.insert(integrationTokens).values({
    householdId,
    createdById: memberId,
    memberId: actsAs,
    name,
    tokenHash: hash,
    scopes,
    expiresAt,
  });

  revalidatePath("/settings/integrations");

  // Return the raw token once — it cannot be recovered after this
  return { rawToken: raw };
}

/**
 * Change a token's name, scopes and who it acts as. The secret stays the same,
 * so whatever uses it carries on with the new permissions from its next call.
 * Expiry is left as it was.
 */
export async function updateIntegrationToken(tokenId: string, formData: FormData) {
  const user = await resolveIdentity();
  const { householdId, role } = await requireHousehold(user);

  if (role !== "admin") throw new Error("Only admins can edit integration tokens");

  const { name, scopes, actsAs } = await readTokenForm(formData, householdId);

  const updated = await db
    .update(integrationTokens)
    .set({ name, scopes, memberId: actsAs })
    .where(and(eq(integrationTokens.id, tokenId), eq(integrationTokens.householdId, householdId)))
    .returning({ id: integrationTokens.id });
  if (!updated.length) throw new Error("That token doesn't exist any more");

  revalidatePath("/settings/integrations");
}

export async function revokeIntegrationToken(tokenId: string) {
  const user = await resolveIdentity();
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

// listIntegrationTokens lives in lib/services/integration-tokens.ts (admin-only,
// takes the session's context) — not here, where any browser could call it.
