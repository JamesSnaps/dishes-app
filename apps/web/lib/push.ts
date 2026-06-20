import webpush from "web-push";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@dishes/db/schema";
import { eq } from "drizzle-orm";

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  icon?: string;
}

function initVapid() {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    throw new Error("VAPID_SUBJECT, VAPID_PUBLIC_KEY, and VAPID_PRIVATE_KEY must be set");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export interface PushOptions {
  /** Skip this user's own devices — e.g. don't notify whoever made the change. */
  excludeAutheliaUser?: string;
}

export async function sendPushToHousehold(
  householdId: string,
  payload: PushPayload,
  options?: PushOptions
): Promise<void> {
  initVapid();

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.householdId, householdId));

  const targets = options?.excludeAutheliaUser
    ? subs.filter((s) => s.autheliaUser !== options.excludeAutheliaUser)
    : subs;

  if (targets.length === 0) return;

  const staleIds: string[] = [];

  await Promise.allSettled(
    targets.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          staleIds.push(sub.id);
        }
      }
    })
  );

  if (staleIds.length > 0) {
    await Promise.all(
      staleIds.map((id) =>
        db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id))
      )
    );
  }
}

/**
 * Fire-and-forget wrapper that never throws (e.g. if VAPID isn't configured),
 * so notifying the household can't break the user action that triggered it.
 */
export async function notifyHousehold(
  householdId: string,
  payload: PushPayload,
  options?: PushOptions
): Promise<void> {
  try {
    await sendPushToHousehold(householdId, payload, options);
  } catch (err) {
    console.error("[push] notifyHousehold failed:", err);
  }
}
