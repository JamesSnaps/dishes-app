/**
 * SMTP config reads. Not a "use server" module: callers pass the session's
 * own context, never a client-supplied household id.
 */

import { db } from "@/lib/db";
import { smtpConfigurations } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import type { PrivilegedContext } from "@/lib/session";

/** Admin only — the household's SMTP settings, without the password. */
export async function getSmtpConfig(ctx: Pick<PrivilegedContext, "householdId" | "role">) {
  if (ctx.role !== "admin") throw new Error("Only admins can view email settings");

  const [config] = await db
    .select({
      id: smtpConfigurations.id,
      host: smtpConfigurations.host,
      port: smtpConfigurations.port,
      username: smtpConfigurations.username,
      fromAddress: smtpConfigurations.fromAddress,
      fromName: smtpConfigurations.fromName,
    })
    .from(smtpConfigurations)
    .where(eq(smtpConfigurations.householdId, ctx.householdId))
    .limit(1);

  if (!config) return null;
  return { ...config, hasPassword: true };
}

/** Whether email sharing is set up — safe for any household member. */
export async function hasSmtpConfig(householdId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: smtpConfigurations.id })
    .from(smtpConfigurations)
    .where(eq(smtpConfigurations.householdId, householdId))
    .limit(1);
  return !!row;
}
