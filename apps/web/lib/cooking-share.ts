import type { CookingSessionInput } from "@/lib/cooking-sessions";

/**
 * The browser's cooks in progress, shared through the server so the
 * household's other devices can follow them: cook on the laptop, see the step
 * and the timers on your Watch (through your iPhone). lib/cooking-sessions.ts
 * is the other end; the iOS app's CookingShare is the same thing there.
 *
 * Only this browser writes its cooks, and nothing that comes back from the
 * server changes cooking mode: responses are only ever read to stop
 * publishing. Every change carries a higher version, a finished cook is ended
 * on the server and can't come back (410 — stop sharing it, keep cooking),
 * and timers go as end times, so a late update still counts down right.
 *
 * Fed from two places, so it follows exactly what's on screen:
 *
 *   showCookShare(...)   // cooking mode: the dish, step and instruction shown
 *   syncCookShares(...)  // the cook-session provider: each cook's timers, and
 *                        // ending a cook once it's no longer in the list
 *
 * A cook is its meal's title (or the recipe's, cooked alone), as on iOS: a
 * different title is a different cook, with its own session id. Dinner and
 * dessert cooked at once are two.
 */

type Shared = Omit<CookingSessionInput, "device"> & { id: string };
type Timer = CookingSessionInput["timers"][number];

const STORAGE_KEY = "dishes:cooking-share:v1";
/** While a cook carries on unchanged (a long simmer), it's republished this often so it doesn't expire. */
const HEARTBEAT_MS = 5 * 60_000;
/** Coalesces a burst of changes (Next, Next, start a timer) into one request. */
const DEBOUNCE_MS = 1000;

interface Stored {
  /** By title. Kept across reloads so the session id stays and the version keeps climbing. */
  cooks: Record<string, Shared>;
  /** Session ids the server has finished with (ended elsewhere, or too old). */
  refused: string[];
}

let state: Stored | null = null;
const timersByTitle = new Map<string, Timer[]>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
let heartbeat: ReturnType<typeof setInterval> | null = null;

function load(): Stored {
  if (state) return state;
  state = { cooks: {}, refused: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Stored;
      state = { cooks: parsed.cooks ?? {}, refused: parsed.refused ?? [] };
    }
  } catch {
    // Storage blocked: shared for this page life only.
  }
  return state;
}

function save() {
  try {
    if (state && Object.keys(state.cooks).length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
}

/** A cook as far as a change goes: a running timer's end time counts, not its countdown. */
function key(cook: Shared): string {
  return JSON.stringify({
    ...cook,
    timers: cook.timers.map((t) => (t.state === "running" ? { ...t, remainingMs: 0 } : t)),
  });
}

/** Takes a changed cook, bumps its version, and publishes it shortly. */
function commit(title: string, next: Shared) {
  const s = load();
  const prev = s.cooks[title];
  if (prev && key(prev) === key(next)) return;
  s.cooks[title] = { ...next, version: (prev?.version ?? 0) + 1 };
  save();
  clearTimeout(pending.get(title));
  pending.set(
    title,
    setTimeout(() => {
      pending.delete(title);
      void publish(title);
    }, DEBOUNCE_MS)
  );
  keepAlive();
}

async function publish(title: string) {
  const s = load();
  const cook = s.cooks[title];
  if (!cook || s.refused.includes(cook.id)) return;
  const { id, ...body } = cook;
  try {
    // JSON Accept so an expired Authelia session answers 401, not a login redirect.
    const res = await fetch(`/api/v1/cooking-sessions/${id}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, device: "Browser" } satisfies CookingSessionInput),
    });
    // 410: ended elsewhere or too old — keep cooking here, stop sharing it.
    // 409: a newer version is already stored; nothing to do.
    if (res.status === 410 && !s.refused.includes(id)) {
      s.refused.push(id);
      save();
    }
  } catch {
    // Offline: the next change or the heartbeat tries again.
  }
}

function keepAlive() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    const titles = Object.keys(load().cooks);
    if (!titles.length) {
      clearInterval(heartbeat!);
      heartbeat = null;
      return;
    }
    for (const title of titles) void publish(title);
  }, HEARTBEAT_MS);
}

function end(title: string) {
  const s = load();
  const cook = s.cooks[title];
  clearTimeout(pending.get(title));
  pending.delete(title);
  timersByTitle.delete(title);
  if (!cook) return;
  delete s.cooks[title];
  s.refused = s.refused.filter((id) => id !== cook.id);
  save();
  // keepalive: Exit navigates away straight after.
  void fetch(`/api/v1/cooking-sessions/${cook.id}`, {
    method: "DELETE",
    credentials: "same-origin",
    keepalive: true,
    headers: { Accept: "application/json" },
  }).catch(() => {});
}

/** Cooking mode changed: what it shows now. `step` is 1-based. */
export function showCookShare(shown: {
  title: string;
  dish: string;
  step: number;
  totalSteps: number;
  instruction: string;
}) {
  if (typeof window === "undefined") return;
  const prev = load().cooks[shown.title];
  commit(shown.title, {
    id: prev?.id ?? crypto.randomUUID(),
    version: prev?.version ?? 0,
    startedAt: prev?.startedAt ?? Date.now(),
    title: shown.title,
    dish: shown.dish,
    step: shown.step,
    totalSteps: shown.totalSteps,
    // Instructions can be long; the Watch shows a screenful.
    instruction: shown.instruction.slice(0, 600),
    // Cooking mode's effects run before the provider's, so just after a reload
    // its timers haven't arrived yet: keep the ones last shared.
    timers: timersByTitle.get(shown.title) ?? prev?.timers ?? [],
  });
}

/**
 * The cooks as the provider holds them: each one's timers go out with it, and
 * a shared cook no longer in the list (Exit, Done, the mini bar's close) ends.
 */
export function syncCookShares(cooks: { title: string; timers: Timer[] }[]) {
  if (typeof window === "undefined") return;
  const live = new Set(cooks.map((c) => c.title));
  for (const title of Object.keys(load().cooks)) if (!live.has(title)) end(title);
  for (const { title, timers } of cooks) {
    timersByTitle.set(title, timers);
    const prev = load().cooks[title];
    if (prev) commit(title, { ...prev, timers });
  }
  // Reopened mid-cook: start the heartbeat again for the cooks still shared.
  if (Object.keys(load().cooks).length) keepAlive();
}
