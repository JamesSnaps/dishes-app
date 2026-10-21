import { getRedis } from "@/lib/redis";

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfter: number };

export async function checkRateLimit(tokenId: string): Promise<RateLimitResult> {
  return checkRateLimitFor(`integration:${tokenId}`, MAX_REQUESTS, WINDOW_SECONDS);
}

/**
 * A fixed window of `max` requests per `windowSeconds` for one key (an
 * integration token, a member calling the AI). No Redis, no limit.
 */
export async function checkRateLimitFor(
  name: string,
  max: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) return { allowed: true, remaining: max };

  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `rate:${name}:${window}`;

  // Atomic INCR + EXPIRE via Lua to avoid a race where the key persists
  // forever if the process crashes between the two commands.
  const count = (await redis.eval(
    `local c = redis.call('INCR', KEYS[1])\nif c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end\nreturn c`,
    1,
    key,
    String(windowSeconds)
  )) as number;

  if (count > max) {
    return { allowed: false, retryAfter: windowSeconds };
  }

  return { allowed: true, remaining: max - count };
}
