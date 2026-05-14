import { getRedis } from "@/lib/redis";

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfter: number };

export async function checkRateLimit(tokenId: string): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) return { allowed: true, remaining: MAX_REQUESTS };

  const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const key = `rate:integration:${tokenId}:${window}`;

  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SECONDS);

  if (count > MAX_REQUESTS) {
    return { allowed: false, retryAfter: WINDOW_SECONDS };
  }

  return { allowed: true, remaining: MAX_REQUESTS - count };
}
