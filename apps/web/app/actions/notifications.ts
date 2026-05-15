"use server";

import { db } from "@/lib/db";
import { notifications } from "@dishes/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import type { Notification } from "@dishes/db/schema";

export async function getNotifications(): Promise<Notification[]> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.householdId, householdId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
}

export async function getUnreadCount(): Promise<number> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.householdId, householdId),
        isNull(notifications.readAt)
      )
    );
  return rows.length;
}

export async function markAllRead(): Promise<void> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.householdId, householdId),
        isNull(notifications.readAt)
      )
    );
}
