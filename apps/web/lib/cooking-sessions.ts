import { z } from "zod";
import { getRedis } from "@/lib/redis";
import { apnsDevicesFor, deliverToApnsDevices } from "@/lib/apns";

/**
 * Cooks in progress, shared across the household's devices: cook on the
 * kitchen iPad, follow the step and the timers on a Watch (through its
 * iPhone). The iOS app's CookingShare is the other end.
 *
 * Short-lived, so it lives in Redis (or memory without it), never the
 * database or the sync log. The rules that keep it from misbehaving:
 *
 *  - **The device cooking owns its session.** Only it writes (PUT), with a
 *    version that goes up each time; an older version than the one stored is
 *    turned down (409), so requests arriving out of order can't step back.
 *  - **Ended is final.** DELETE leaves a tombstone for a day, and a PUT to an
 *    ended session is refused (410), so a cooking mode left open on another
 *    device can't bring a finished cook back.
 *  - **Old cooks don't come back.** A session started more than 12 hours ago
 *    is refused too, and one not heard from for 2 hours expires.
 *  - **Nothing here changes a device's cooking mode.** Other devices only read
 *    (GET). A changed cook sends the household's iOS devices a silent push
 *    (`kind: "cooking"`) so a phone with a Watch fetches it; heartbeats that
 *    change nothing don't.
 *
 * Times are epoch ms.
 */

const timerSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(200),
  dish: z.string().max(200).nullish(),
  endsAt: z.number().nullish(),
  remainingMs: z.number().min(0),
  durationMs: z.number().min(0).nullish(),
  state: z.enum(["running", "paused", "finished"]),
});

export const cookingSessionSchema = z.object({
  version: z.number().int().min(1),
  startedAt: z.number(),
  title: z.string().max(300),
  device: z.string().max(60),
  dish: z.string().max(300),
  step: z.number().int().min(0),
  totalSteps: z.number().int().min(0),
  instruction: z.string().max(2000),
  timers: z.array(timerSchema).max(30),
});

export type CookingSessionInput = z.infer<typeof cookingSessionSchema>;

export interface CookingSession extends CookingSessionInput {
  id: string;
  householdId: string;
  memberId: string;
  memberName: string;
  updatedAt: number;
}

/** Not heard from for this long: the cook is over (the app closed mid-cook). */
const LIVE_MS = 2 * 60 * 60_000;
/** An ended session is remembered this long, so it can't be revived. */
const TOMBSTONE_MS = 24 * 60 * 60_000;
/** A session started longer ago than this is refused. */
const MAX_AGE_MS = 12 * 60 * 60_000;

const KEY = (householdId: string, id: string) => `cooksession:${householdId}:${id}`;
const ENDED = (householdId: string, id: string) => `cooksession:ended:${householdId}:${id}`;
const INDEX = (householdId: string) => `cooksession:index:${householdId}`;

declare global {
  var __cookingSessions: Map<string, { value: string; until: number }> | undefined;
}
const memory = (globalThis.__cookingSessions ??= new Map());

async function get(key: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) return redis.get(key);
  const hit = memory.get(key);
  if (!hit || hit.until < Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

async function set(key: string, value: string, ttlMs: number): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(key, value, "PX", ttlMs);
    return;
  }
  memory.set(key, { value, until: Date.now() + ttlMs });
}

async function del(key: string): Promise<void> {
  const redis = getRedis();
  if (redis) await redis.del(key);
  else memory.delete(key);
}

async function indexAdd(householdId: string, id: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.sadd(INDEX(householdId), id);
    await redis.pexpire(INDEX(householdId), TOMBSTONE_MS);
    return;
  }
  const ids = new Set<string>(JSON.parse((await get(INDEX(householdId))) ?? "[]"));
  ids.add(id);
  await set(INDEX(householdId), JSON.stringify([...ids]), TOMBSTONE_MS);
}

async function indexAll(householdId: string): Promise<string[]> {
  const redis = getRedis();
  if (redis) return redis.smembers(INDEX(householdId));
  return JSON.parse((await get(INDEX(householdId))) ?? "[]");
}

async function indexRemove(householdId: string, id: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.srem(INDEX(householdId), id);
    return;
  }
  const ids = new Set<string>(JSON.parse((await get(INDEX(householdId))) ?? "[]"));
  ids.delete(id);
  await set(INDEX(householdId), JSON.stringify([...ids]), TOMBSTONE_MS);
}

export type PublishResult = "ok" | "stale" | "ended";

/** What other devices show; a change in it is worth a push, a heartbeat isn't. */
function shown(s: CookingSessionInput): string {
  return JSON.stringify([s.title, s.dish, s.step, s.totalSteps, s.instruction, s.timers]);
}

export async function publishCookingSession(
  ctx: { householdId: string; memberId: string; actorName: string },
  id: string,
  input: CookingSessionInput,
  now = Date.now()
): Promise<PublishResult> {
  if (await get(ENDED(ctx.householdId, id))) return "ended";
  if (input.startedAt < now - MAX_AGE_MS) return "ended";

  const raw = await get(KEY(ctx.householdId, id));
  const previous = raw ? (JSON.parse(raw) as CookingSession) : null;
  // Another member can't write over someone else's cook (it would need their session id anyway).
  if (previous && previous.memberId !== ctx.memberId) return "ended";
  if (previous && input.version < previous.version) return "stale";

  const session: CookingSession = {
    ...input,
    id,
    householdId: ctx.householdId,
    memberId: ctx.memberId,
    memberName: ctx.actorName,
    updatedAt: now,
  };
  await set(KEY(ctx.householdId, id), JSON.stringify(session), LIVE_MS);
  await indexAdd(ctx.householdId, id);

  if (!previous || shown(previous) !== shown(input)) await notify(ctx.householdId);
  return "ok";
}

export async function endCookingSession(ctx: { householdId: string; memberId: string }, id: string): Promise<void> {
  const raw = await get(KEY(ctx.householdId, id));
  const previous = raw ? (JSON.parse(raw) as CookingSession) : null;
  if (previous && previous.memberId !== ctx.memberId) return;
  await set(ENDED(ctx.householdId, id), "1", TOMBSTONE_MS);
  await del(KEY(ctx.householdId, id));
  await indexRemove(ctx.householdId, id);
  if (previous) await notify(ctx.householdId);
}

/** The household's cooks in progress, most recently changed first. */
export async function listCookingSessions(householdId: string): Promise<CookingSession[]> {
  const out: CookingSession[] = [];
  for (const id of await indexAll(householdId)) {
    const raw = await get(KEY(householdId, id));
    if (raw) out.push(JSON.parse(raw) as CookingSession);
    else await indexRemove(householdId, id); // expired
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A silent push to the household's iOS devices: the ones with a Watch fetch the cooks. */
async function notify(householdId: string): Promise<void> {
  try {
    const devices = await apnsDevicesFor(householdId);
    await deliverToApnsDevices(devices, null, { silent: true, data: { kind: "cooking" } });
  } catch (err) {
    console.error("[cooking-sessions] push failed:", err);
  }
}
