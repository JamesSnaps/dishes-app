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

export async function sendPushToHousehold(
  householdId: string,
  payload: PushPayload
): Promise<void> {
  initVapid();

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.householdId, householdId));

  if (subs.length === 0) return;

  const staleIds: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
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
