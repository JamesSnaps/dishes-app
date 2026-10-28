/**
 * Integration token reads. Not a "use server" module: callers pass the
 * session's own context, never a client-supplied household id.
 */

import { db } from "@/lib/db";
import { householdMembers, integrationTokens } from "@dishes/db/schema";
import { and, asc, eq } from "drizzle-orm";
import type { PrivilegedContext } from "@/lib/session";

/** Admin only — the household's integration tokens (metadata, never the secret). */
export async function listIntegrationTokens(ctx: Pick<PrivilegedContext, "householdId" | "role">) {
  if (ctx.role !== "admin") throw new Error("Only admins can view integration tokens");

  return db
    .select({
      id: integrationTokens.id,
      name: integrationTokens.name,
      scopes: integrationTokens.scopes,
      actsAs: householdMembers.displayName,
      lastUsedAt: integrationTokens.lastUsedAt,
      expiresAt: integrationTokens.expiresAt,
      createdAt: integrationTokens.createdAt,
    })
    .from(integrationTokens)
    .leftJoin(householdMembers, eq(householdMembers.id, integrationTokens.memberId))
    .where(eq(integrationTokens.householdId, ctx.householdId))
    .orderBy(integrationTokens.createdAt);
}

/** The members a new token can act as: the household's active members. */
export async function listTokenMembers(householdId: string) {
  return db
    .select({ id: householdMembers.id, displayName: householdMembers.displayName })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.isActive, true)))
    .orderBy(asc(householdMembers.displayName));
}
