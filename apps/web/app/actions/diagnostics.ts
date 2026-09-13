"use server";

import { db } from "@/lib/db";
import { clientErrors } from "@dishes/db/schema";
import { desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export interface ClientErrorRow {
  id: string;
  message: string;
  stack: string | null;
  digest: string | null;
  url: string | null;
  source: string | null;
  userAgent: string | null;
  appVersion: string | null;
  autheliaUser: string | null;
  createdAt: Date;
}

async function requireAdmin() {
  const user = await getAutheliaUser();
  const { role } = await requireHousehold(user);
  if (role !== "admin") throw new Error("Only admins can view diagnostics");
}

/**
 * Crash reports, newest first. Not household-filtered by design — see the note
 * on the `client_errors` table: a report is recorded even when no household
 * could be resolved, and those are precisely the reports worth seeing. The
 * admin check above is the access boundary.
 */
export async function getClientErrors(limit = 50): Promise<ClientErrorRow[]> {
  await requireAdmin();

  return db
    .select({
      id: clientErrors.id,
      message: clientErrors.message,
      stack: clientErrors.stack,
      digest: clientErrors.digest,
      url: clientErrors.url,
      source: clientErrors.source,
      userAgent: clientErrors.userAgent,
      appVersion: clientErrors.appVersion,
      autheliaUser: clientErrors.autheliaUser,
      createdAt: clientErrors.createdAt,
    })
    .from(clientErrors)
    .orderBy(desc(clientErrors.createdAt))
    .limit(limit);
}

export async function clearClientErrors() {
  await requireAdmin();
  await db.delete(clientErrors);
  revalidatePath("/settings/diagnostics");
}
