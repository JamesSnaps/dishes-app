import { getRedis } from "@/lib/redis";
import { sendPushToUsers } from "@/lib/push";

/**
 * Push notifications for cooking-mode timers that finish while you're away
 * from the app.
 *
 * Cooking mode hands the server its running timers when the app goes into
 * the background (phone locked, app switched, closed) and takes them back when
 * it returns. So the server only ever pushes for timers you can't otherwise
 * hear: on screen, the in-app chime does the job, and there's no double alert.
 *
 * Timers are held per device — the laptop opening Dishes must not cancel the
 * phone's roast — in Redis, so a container restart mid-cook doesn't lose them,
 * and each one fires from its own setTimeout, to the second (the minute-level
 * reminder loop is too coarse for a five-minute timer).
 */

export type DeviceTimer = {
  /** Stable per timer on the device, e.g. "<recipeId>:<stepIndex>". */
  key: string;
  /** Epoch ms the timer finishes. */
  endsAt: number;
  title: string;
  body: string;
  url: string;
};

type DeviceRecord = {
  householdId: string;
  /** The Authelia user to notify — all their subscribed devices get it. */
  user: string;
  timers: DeviceTimer[];
};

const KEY_PREFIX = "cooktimers:";
/** A timer the server missed (container down) is still worth sending this late. */
const LATE_GRACE_MS = 10 * 60_000;
/** Longest timer accepted — anything further out is a bad value. */
const MAX_AHEAD_MS = 24 * 60 * 60_000;
const MAX_TIMERS = 30;

declare global {
  var __cookTimerHandles: Map<string, NodeJS.Timeout[]> | undefined;
  var __cookTimerMemory: Map<string, DeviceRecord> | undefined;
  var __cookTimerRestored: boolean | undefined;
}

// Live setTimeout handles per device, and the store used when Redis is absent.
const handles = (globalThis.__cookTimerHandles ??= new Map());
const memory = (globalThis.__cookTimerMemory ??= new Map());

function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function storeKey(memberId: string, deviceId: string): string {
  return `${KEY_PREFIX}${memberId}:${deviceId}`;
}

async function readRecord(key: string): Promise<DeviceRecord | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as DeviceRecord) : null;
    } catch (err) {
      console.error("[cook-timers] redis read failed, using memory:", err);
    }
  }
  return memory.get(key) ?? null;
}

async function writeRecord(key: string, record: DeviceRecord | null): Promise<void> {
  if (record && record.timers.length) memory.set(key, record);
  else memory.delete(key);

  const redis = getRedis();
  if (!redis) return;
  try {
    if (!record || !record.timers.length) {
      await redis.del(key);
      return;
    }
    const last = Math.max(...record.timers.map((t) => t.endsAt));
    const ttl = Math.max(60, Math.ceil((last - Date.now() + LATE_GRACE_MS) / 1000));
    await redis.set(key, JSON.stringify(record), "EX", ttl);
  } catch (err) {
    console.error("[cook-timers] redis write failed, memory only:", err);
  }
}

/** Claim one timer's send, so two containers (or a restart) can't both push it. */
async function claimSend(key: string, timer: DeviceTimer): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  try {
    const claim = `${key}:sent:${timer.key}:${timer.endsAt}`;
    return (await redis.set(claim, "1", "EX", 3600, "NX")) === "OK";
  } catch {
    return true;
  }
}

async function fire(key: string, timerKey: string, endsAt: number): Promise<void> {
  const record = await readRecord(key);
  // Gone, or replaced (paused and restarted): the app has taken it back.
  const timer = record?.timers.find((t) => t.key === timerKey && t.endsAt === endsAt);
  if (!record || !timer) return;

  // Done either way — drop it so a restore can't send it again.
  await writeRecord(key, { ...record, timers: record.timers.filter((t) => t !== timer) });

  if (!(await claimSend(key, timer))) return;
  try {
    const result = await sendPushToUsers(record.householdId, [record.user], {
      title: timer.title,
      body: timer.body,
      url: timer.url,
      tag: `cooktimer-${timer.key}`,
    });
    console.info(`[cook-timers] ${timer.key} sent=${result.sent} failed=${result.failed}`);
  } catch (err) {
    console.error(`[cook-timers] push failed for ${timer.key}:`, err);
  }
}

function schedule(key: string, record: DeviceRecord | null): void {
  for (const h of handles.get(key) ?? []) clearTimeout(h);
  handles.delete(key);
  if (!record || !pushConfigured()) return;

  const now = Date.now();
  const next: NodeJS.Timeout[] = [];
  for (const t of record.timers) {
    if (t.endsAt < now - LATE_GRACE_MS) continue;
    const delay = Math.max(0, t.endsAt - now);
    next.push(setTimeout(() => void fire(key, t.key, t.endsAt), delay));
  }
  if (next.length) handles.set(key, next);
}

function clean(timers: DeviceTimer[]): DeviceTimer[] {
  const now = Date.now();
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  return timers
    .filter(
      (t) =>
        t &&
        typeof t.endsAt === "number" &&
        t.endsAt > now - LATE_GRACE_MS &&
        t.endsAt < now + MAX_AHEAD_MS &&
        typeof t.key === "string" &&
        t.key.length > 0
    )
    .slice(0, MAX_TIMERS)
    .map((t) => ({
      key: str(t.key, 120),
      endsAt: Math.round(t.endsAt),
      title: str(t.title, 120) || "Timer done",
      body: str(t.body, 240),
      // Same-origin paths only — never let a client point a notification elsewhere.
      url: typeof t.url === "string" && t.url.startsWith("/") && !t.url.startsWith("//") ? t.url : "/",
    }));
}

/**
 * Replace one device's pending timers. An empty list cancels them all — the
 * app does that when it comes back to the foreground.
 */
export async function setDeviceTimers(
  identity: { householdId: string; memberId: string; user: string },
  deviceId: string,
  timers: DeviceTimer[]
): Promise<number> {
  const key = storeKey(identity.memberId, deviceId);
  const kept = clean(timers);
  const record = kept.length
    ? { householdId: identity.householdId, user: identity.user, timers: kept }
    : null;
  await writeRecord(key, record);
  schedule(key, record);
  return kept.length;
}

/**
 * Re-arm every pending timer after a restart. Ones that came due while the
 * server was down still go out if they're only a little late.
 */
export async function restoreCookTimers(): Promise<void> {
  if (globalThis.__cookTimerRestored) return;
  globalThis.__cookTimerRestored = true;
  if (!pushConfigured()) return;

  const redis = getRedis();
  if (!redis) return;
  try {
    let cursor = "0";
    let restored = 0;
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${KEY_PREFIX}*`, "COUNT", 100);
      cursor = next;
      for (const key of keys) {
        if (key.includes(":sent:")) continue;
        const record = await readRecord(key);
        if (record) {
          schedule(key, record);
          restored += record.timers.length;
        }
      }
    } while (cursor !== "0");
    if (restored) console.info(`[cook-timers] restored ${restored} pending timer(s)`);
  } catch (err) {
    console.error("[cook-timers] restore failed:", err);
  }
}
