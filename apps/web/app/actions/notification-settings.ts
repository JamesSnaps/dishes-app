"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import {
  getNotificationSettings,
  removeNotificationDevice,
  setNotificationPref,
} from "@/lib/services/notification-settings";
import type { NotificationType } from "@/lib/notification-types";

export async function getMyNotificationSettings() {
  return getNotificationSettings(await requireSession());
}

export async function setMyNotificationPref(type: NotificationType, enabled: boolean) {
  const session = await requireSession();
  await setNotificationPref(session, { type, enabled });
  revalidatePath("/settings/notifications");
  revalidatePath("/settings/dinner-reminders");
  revalidatePath("/settings/deliveries");
}

export async function removeMyNotificationDevice(id: string) {
  const session = await requireSession();
  await removeNotificationDevice(session, id);
  revalidatePath("/settings/notifications");
}
