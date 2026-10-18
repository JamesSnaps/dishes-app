import { getRedis } from "@/lib/redis";
import { sendLiveActivity } from "@/lib/apns";
import { getMealClock, type MealClock } from "@/lib/services/meal-clock";

/**
 * The iOS meal-schedule Live Activity: the next step of tonight's meal on the
 * Lock Screen, counting down, kept current by APNs while the app is closed.
 *
 * The app starts the activity and hands over its push token
 * (POST /api/v1/live-activities); this keeps the tokens in Redis until the
 * meal is served, and the minute tick sends an update whenever the next cue
 * changes, then ends the activity half an hour after serving.
 *
 * The content state matches MealScheduleAttributes.ContentState in
 * apps/ios/Shared — times are Unix seconds so the app decodes them as plain
 * numbers.
 */

interface Registration {
  token: string;
  environment: string;
  householdId: string;
  memberId: string;
  groupId: string;
  /**
   * The cue last sent and its times, so an update only goes out when it
   * changes — including when the meal is moved and the next cue stays the same.
   */
  sentCue: string | null;
}

const KEY = (token: string) => `liveact:${token}`;
const ALL = "liveact:all";
/** Kept this long after serving, then ended and forgotten. */
const AFTER_SERVE_MS = 30 * 60_000;

declare global {
  var __liveActivities: Map<string, Registration> | undefined;
}
const memory = (globalThis.__liveActivities ??= new Map());

async function save(reg: Registration, until: number): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memory.set(reg.token, reg);
    return;
  }
  const ttl = Math.max(60, Math.ceil((until - Date.now()) / 1000));
  await redis.set(KEY(reg.token), JSON.stringify(reg), "EX", ttl);
  await redis.sadd(ALL, reg.token);
}

async function forget(token: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memory.delete(token);
    return;
  }
  await redis.del(KEY(token));
  await redis.srem(ALL, token);
}

async function all(): Promise<Registration[]> {
  const redis = getRedis();
  if (!redis) return [...memory.values()];
  const tokens = await redis.smembers(ALL);
  const out: Registration[] = [];
  for (const token of tokens) {
    const raw = await redis.get(KEY(token));
    if (raw) out.push(JSON.parse(raw) as Registration);
    else await redis.srem(ALL, token); // expired
  }
  return out;
}

/** What the Lock Screen shows at `now`. */
export function liveActivityState(clock: MealClock, now: number) {
  const upcoming = clock.cues.filter((c) => c.id !== "serve" && c.at > now - 60_000);
  const next = upcoming[0];
  const after = upcoming[1];
  const line = (c: MealClock["cues"][number]) => (c.dish ? `${c.dish}: ${c.text}` : c.text);
  const nextAt = Math.floor((next?.at ?? clock.serveAt) / 1000);
  const serveAt = Math.floor(clock.serveAt / 1000);
  return {
    cueId: `${next?.id ?? "serve"}@${nextAt}/${serveAt}`,
    state: {
      nextAt,
      nextText: next ? line(next) : "Serve",
      afterText: after ? line(after) : null,
      serveAt,
      stepsLeft: upcoming.length,
    },
  };
}

export async function registerLiveActivity(input: {
  token: string;
  environment: string;
  householdId: string;
  memberId: string;
  groupId: string;
}): Promise<void> {
  const clock = await getMealClock(input, input.groupId);
  if (!clock) return;
  // The app started the activity with the current state, so that cue is sent.
  const { cueId } = liveActivityState(clock, Date.now());
  await save({ ...input, sentCue: cueId }, clock.serveAt + AFTER_SERVE_MS);
}

export async function unregisterLiveActivity(token: string): Promise<void> {
  await forget(token);
}

/** Once a minute, from the dinner-reminder scheduler. */
export async function runLiveActivityTick(): Promise<void> {
  const now = Date.now();
  for (const reg of await all()) {
    try {
      const clock = await getMealClock(reg, reg.groupId);
      if (!clock || now > clock.serveAt + AFTER_SERVE_MS) {
        const final = clock ? liveActivityState(clock, now).state : null;
        if (final) await sendLiveActivity(reg.token, reg.environment, "end", final, { dismissalDate: now });
        await forget(reg.token);
        continue;
      }
      const { cueId, state } = liveActivityState(clock, now);
      if (cueId === reg.sentCue) continue;
      const alive = await sendLiveActivity(reg.token, reg.environment, "update", state, {
        staleDate: clock.serveAt + AFTER_SERVE_MS,
      });
      console.info(`[live-activities] ${reg.groupId} next=${cueId} sent=${alive}`);
      if (!alive) await forget(reg.token);
      else await save({ ...reg, sentCue: cueId }, clock.serveAt + AFTER_SERVE_MS);
    } catch (err) {
      console.error(`[live-activities] ${reg.groupId} failed:`, err);
    }
  }
}
