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

  // Atomic INCR + EXPIRE via Lua to avoid a race where the key persists
  // forever if the process crashes between the two commands.
  const count = (await redis.eval(
    `local c = redis.call('INCR', KEYS[1])\nif c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end\nreturn c`,
    1,
    key,
    String(WINDOW_SECONDS)
  )) as number;

  if (count > MAX_REQUESTS) {
    return { allowed: false, retryAfter: WINDOW_SECONDS };
  }

  return { allowed: true, remaining: MAX_REQUESTS - count };
}
