import webpush from "web-push";
import { db } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { pushSubscriptions, type PushSubscription } from "@dishes/db/schema";
import { and, eq } from "drizzle-orm";

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  icon?: string;
}

function initVapid() {
  const rawSubject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!rawSubject || !publicKey || !privateKey) {
    throw new Error("VAPID_SUBJECT, VAPID_PUBLIC_KEY, and VAPID_PRIVATE_KEY must be set");
  }
  // web-push requires the subject to be a mailto: or https: URI and throws otherwise.
  // Tolerate a bare email/host in the env by defaulting it to a mailto: URI.
  const subject = /^(mailto:|https?:\/\/)/.test(rawSubject) ? rawSubject : `mailto:${rawSubject}`;
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export interface PushOptions {
  /** Skip this user's own devices — e.g. don't notify whoever made the change. */
  excludeAutheliaUser?: string;
}

interface DeliveryResult {
  sent: number;
  failed: number;
  stale: number;
}

/**
 * Deliver a payload to each subscription. Subscriptions the push service reports
 * as gone (404/410) are pruned. Any other failure — VAPID key mismatch, payload
 * too large, rate limit, push-service outage — is logged with its HTTP status,
 * endpoint host, and response body so the reason is visible in the container logs
 * (`docker compose logs web`). Returns per-outcome counts.
 */
async function deliverToSubscriptions(
  targets: PushSubscription[],
  payload: PushPayload
): Promise<DeliveryResult> {
  if (targets.length === 0) return { sent: 0, failed: 0, stale: 0 };

  const staleIds: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.allSettled(
    targets.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
        sent++;
      } catch (err: unknown) {
        const { statusCode, body } = err as { statusCode?: number; body?: string };
        if (statusCode === 410 || statusCode === 404) {
          staleIds.push(sub.id);
          return;
        }
        failed++;
        let host = "unknown";
        try {
          host = new URL(sub.endpoint).host;
        } catch {
          // endpoint isn't a valid URL — leave host as "unknown"
        }
        const detail = body || (err instanceof Error ? err.message : "unknown error");
        console.error(
          `[push] send failed: status=${statusCode ?? "?"} host=${host} detail=${detail}`
        );
      }
    })
  );

  if (staleIds.length > 0) {
    console.info(`[push] pruning ${staleIds.length} stale subscription(s) (404/410)`);
    await Promise.all(
      staleIds.map((id) =>
        db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id))
      )
    );
  }

  return { sent, failed, stale: staleIds.length };
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

  await deliverToSubscriptions(targets, payload);
}

/** Outcome of a single-device send — drives the test-notification response. */
export type EndpointPushOutcome = "sent" | "no_subscription" | "stale" | "failed";

/**
 * Send a payload to a single device by its push endpoint, scoped to the household
 * so a device can only be targeted by its own household. Used by the
 * "send test notification" action; the outcome distinguishes a successful send
 * from a missing/expired subscription or a rejected delivery (logged in
 * deliverToSubscriptions) so the caller can give an accurate message.
 */
export async function sendPushToEndpoint(
  householdId: string,
  endpoint: string,
  payload: PushPayload
): Promise<EndpointPushOutcome> {
  initVapid();

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.householdId, householdId),
        eq(pushSubscriptions.endpoint, endpoint)
      )
    );

  if (subs.length === 0) return "no_subscription";

  const { sent, stale } = await deliverToSubscriptions(subs, payload);
  if (sent > 0) return "sent";
  if (stale > 0) return "stale";
  return "failed";
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

/**
 * Leading-edge cooldown wrapper around {@link notifyHousehold}. The first call for
 * a given (household, channel) sends immediately; further calls within
 * `windowSeconds` are suppressed. This collapses a burst of rapid changes —
 * e.g. typing several shopping-list items in a row — into a single push, since
 * the push only needs to wake the recipient's device to refresh, not enumerate
 * every change.
 *
 * A true trailing debounce (notify once after activity stops) would need a
 * scheduler/worker we don't run in Phase 1, so this leading-edge approach is the
 * pragmatic equivalent. Without Redis configured it falls back to notifying on
 * every call (no throttle).
 */
export async function notifyHouseholdThrottled(
  householdId: string,
  channel: string,
  windowSeconds: number,
  payload: PushPayload,
  options?: PushOptions
): Promise<void> {
  try {
    const redis = getRedis();
    if (redis) {
      const key = `pushcd:${channel}:${householdId}`;
      // SET NX EX — only the first caller in the window acquires the key and sends.
      const acquired = await redis.set(key, "1", "EX", windowSeconds, "NX");
      if (acquired !== "OK") return; // still cooling down — suppress
    }
  } catch (err) {
    // Redis hiccup shouldn't drop the notification — fall through and send.
    console.error("[push] throttle check failed, sending anyway:", err);
  }
  await notifyHousehold(householdId, payload, options);
}
