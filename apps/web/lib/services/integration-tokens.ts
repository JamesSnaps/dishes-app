/**
 * Integration token reads. Not a "use server" module: callers pass the
 * session's own context, never a client-supplied household id.
 */

import { db } from "@/lib/db";
import { integrationTokens } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import type { PrivilegedContext } from "@/lib/session";

/** Admin only — the household's integration tokens (metadata, never the secret). */
export async function listIntegrationTokens(ctx: Pick<PrivilegedContext, "householdId" | "role">) {
  if (ctx.role !== "admin") throw new Error("Only admins can view integration tokens");

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
    .where(eq(integrationTokens.householdId, ctx.householdId))
    .orderBy(integrationTokens.createdAt);
}
