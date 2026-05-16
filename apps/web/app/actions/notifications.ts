"use server";

import { db } from "@/lib/db";
import { notifications, recipes } from "@dishes/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";
import type { Notification } from "@dishes/db/schema";

export type NotificationWithImage = Notification & {
  recipeThumbnailUrl: string | null;
};

export async function getNotifications(): Promise<NotificationWithImage[]> {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const rows = await db
    .select({
      id: notifications.id,
      householdId: notifications.householdId,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      recipeId: notifications.recipeId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      recipeThumbnailUrl: recipes.thumbnailUrl,
    })
    .from(notifications)
    .leftJoin(recipes, eq(notifications.recipeId, recipes.id))
    .where(eq(notifications.householdId, householdId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  return rows.map((r) => ({ ...r, recipeThumbnailUrl: r.recipeThumbnailUrl ?? null }));
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
