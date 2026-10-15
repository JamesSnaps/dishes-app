import { getRedis } from "@/lib/redis";

/**
 * Once-only guard for scheduled pushes. A reminder loop ticks every minute and
 * may see the same reminder as due on several ticks (or after a restart);
 * `claimReminder` returns true for exactly one of them per key.
 */

const SENT_TTL_SECONDS = 36 * 60 * 60;

// Fallback dedupe when Redis isn't configured. Lost on restart, which at worst
// means one repeat reminder if the container restarts inside the window.
const sentLocally = new Set<string>();

export async function claimReminder(key: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.set(key, "1", "EX", SENT_TTL_SECONDS, "NX")) === "OK";
    } catch (err) {
      console.error("[reminders] redis claim failed, using memory:", err);
    }
  }
  if (sentLocally.has(key)) return false;
  sentLocally.add(key);
  if (sentLocally.size > 500) sentLocally.clear();
  return true;
}
