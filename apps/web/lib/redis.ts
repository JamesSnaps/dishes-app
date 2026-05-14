import Redis from "ioredis";
import { env } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | null | undefined;
}

function createRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  return new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
}

export const redis: Redis | null =
  process.env.NODE_ENV === "production"
    ? createRedis()
    : (global.__redis ??= createRedis());
