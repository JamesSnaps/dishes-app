import Redis from "ioredis";

declare global {
  var __redis: Redis | null | undefined;
}

function createRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
}

// Lazy getter — safe to call at module load; defers connection until first use
// so the module is safe to import at build time without REDIS_URL being set.
export function getRedis(): Redis | null {
  if (process.env.NODE_ENV === "production") return createRedis();
  return (global.__redis ??= createRedis());
}
