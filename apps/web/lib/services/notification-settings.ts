import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { apnsDevices, householdMembers, pushSubscriptions } from "@dishes/db/schema";
import { db } from "@/lib/db";
import { apnsConfigured } from "@/lib/apns";
import {
  NOTIFICATION_TYPES,
  wantsNotification,
  type NotificationType,
} from "@/lib/notification-types";
import type { HouseholdContext, Session } from "@/lib/session";

/**
 * A member's notification choices and the devices they'll arrive on — the
 * Settings → Notifications screen on the web and in the iOS app.
 */

export type NotificationDevice = {
  id: string;
  kind: "web" | "ios";
  name: string;
  createdAt: string;
};

export type NotificationSettings = {
  types: {
    id: NotificationType;
    title: string;
    description: string;
    group: string;
    enabled: boolean;
  }[];
  devices: NotificationDevice[];
};

/** A readable name for a browser from its user agent. */
function browserName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
    ? "iPad"
    : /Android/.test(ua)
    ? "Android"
    : /Macintosh/.test(ua)
    ? "Mac"
    : /Windows/.test(ua)
    ? "Windows"
    : /Linux/.test(ua)
    ? "Linux"
    : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
    ? "Firefox"
    : /Chrome\//.test(ua) && !/CriOS/.test(ua)
    ? "Chrome"
    : /Safari\//.test(ua)
    ? "Safari"
    : "Browser";
  return device ? `${browser} on ${device}` : browser;
}

export async function getNotificationSettings(session: Session): Promise<NotificationSettings> {
  const [[me], web, ios] = await Promise.all([
    db
      .select({
        dinnerReminders: householdMembers.dinnerReminders,
        deliveryReminders: householdMembers.deliveryReminders,
        notificationPrefs: householdMembers.notificationPrefs,
      })
      .from(householdMembers)
      .where(eq(householdMembers.id, session.memberId))
      .limit(1),
    db
      .select()
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.householdId, session.householdId),
          eq(pushSubscriptions.autheliaUser, session.user.username)
        )
      )
      .orderBy(desc(pushSubscriptions.createdAt)),
    db
      .select()
      .from(apnsDevices)
      .where(
        and(
          eq(apnsDevices.householdId, session.householdId),
          eq(apnsDevices.autheliaUser, session.user.username)
        )
      )
      .orderBy(desc(apnsDevices.updatedAt)),
  ]);

  const fields = me ?? { dinnerReminders: false, deliveryReminders: false, notificationPrefs: {} };
  return {
    types: NOTIFICATION_TYPES.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      group: t.group,
      enabled: wantsNotification(fields, t.id),
    })),
    devices: [
      ...ios.map((d) => ({
        id: d.id,
        kind: "ios" as const,
        name: d.deviceName || "iPhone or iPad",
        createdAt: d.createdAt.toISOString(),
      })),
      ...web.map((s) => ({
        id: s.id,
        kind: "web" as const,
        name: browserName(s.userAgent),
        createdAt: s.createdAt.toISOString(),
      })),
    ],
  };
}

export const notificationPrefSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES.map((t) => t.id) as [NotificationType, ...NotificationType[]]),
  enabled: z.boolean(),
});

export async function setNotificationPref(
  ctx: HouseholdContext,
  input: z.infer<typeof notificationPrefSchema>
): Promise<void> {
  const { type, enabled } = notificationPrefSchema.parse(input);
  // These two have their own columns, which their schedulers query.
  if (type === "dinner") {
    await db.update(householdMembers).set({ dinnerReminders: enabled }).where(eq(householdMembers.id, ctx.memberId));
    return;
  }
  if (type === "delivery_deadline") {
    await db.update(householdMembers).set({ deliveryReminders: enabled }).where(eq(householdMembers.id, ctx.memberId));
    return;
  }
  await db.transaction(async (tx) => {
    const [me] = await tx
      .select({ prefs: householdMembers.notificationPrefs })
      .from(householdMembers)
      .where(eq(householdMembers.id, ctx.memberId))
      .for("update")
      .limit(1);
    await tx
      .update(householdMembers)
      .set({ notificationPrefs: { ...(me?.prefs ?? {}), [type]: enabled } })
      .where(eq(householdMembers.id, ctx.memberId));
  });
}

/** Stop sending to one of your own devices (web or iOS). */
export async function removeNotificationDevice(session: Session, id: string): Promise<void> {
  await Promise.all([
    db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.id, id),
          eq(pushSubscriptions.householdId, session.householdId),
          eq(pushSubscriptions.autheliaUser, session.user.username)
        )
      ),
    db
      .delete(apnsDevices)
      .where(
        and(
          eq(apnsDevices.id, id),
          eq(apnsDevices.householdId, session.householdId),
          eq(apnsDevices.autheliaUser, session.user.username)
        )
      ),
  ]);
}

export const apnsDeviceSchema = z.object({
  token: z.string().regex(/^[0-9a-fA-F]{32,200}$/, "token must be the device token in hex"),
  environment: z.enum(["sandbox", "production"]).default("production"),
  deviceName: z.string().trim().max(255).optional(),
});

/** Register (or move to this member) an iOS device token. */
export async function registerApnsDevice(
  session: Session,
  input: z.input<typeof apnsDeviceSchema>
): Promise<{ id: string; apnsConfigured: boolean }> {
  const { token, environment, deviceName } = apnsDeviceSchema.parse(input);
  const values = {
    householdId: session.householdId,
    autheliaUser: session.user.username,
    token: token.toLowerCase(),
    environment,
    deviceName: deviceName || null,
  };
  const [row] = await db
    .insert(apnsDevices)
    .values(values)
    .onConflictDoUpdate({ target: apnsDevices.token, set: { ...values, updatedAt: new Date() } })
    .returning({ id: apnsDevices.id });
  return { id: row!.id, apnsConfigured: apnsConfigured() };
}

export async function unregisterApnsDevice(session: Session, token: string): Promise<void> {
  await db
    .delete(apnsDevices)
    .where(
      and(
        eq(apnsDevices.token, token.toLowerCase()),
        eq(apnsDevices.householdId, session.householdId),
        eq(apnsDevices.autheliaUser, session.user.username)
      )
    );
}
