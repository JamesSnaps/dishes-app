"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { playChime, unlockAudio } from "@/lib/cook-audio";

// A cook session lives above the route tree so it survives navigation out of
// cooking mode — that's what lets the mini bar "minimise" a cook instead of
// ending it. Timers are stored as deadlines rather than countdowns so they stay
// accurate while the tab is backgrounded (mobile browsers throttle intervals
// hard, so a decrementing counter drifts badly once you switch away).

const STORAGE_KEY = "dishes:cook-sessions:v2";
/** v1 held a single session; it is migrated into the list on first load. */
const LEGACY_STORAGE_KEY = "dishes:cook-session:v1";

/** Abandoned cooks are swept on load — yesterday's dinner shouldn't greet you at breakfast. */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** A timer as stored: deadline-based. */
interface StoredTimer {
  stepNumber: number;
  totalSeconds: number;
  label: string | null;
  preview: string;
  /** Epoch ms at which a running timer finishes; null while paused. */
  endsAt: number | null;
  /** Seconds left while paused; ignored while running. */
  pausedRemaining: number;
  done: boolean;
}

/** A timer as the UI consumes it — `remaining` is derived from the clock each tick. */
export interface TimerState {
  remaining: number;
  running: boolean;
  done: boolean;
  totalSeconds: number;
  label: string | null;
  stepNumber: number;
  preview: string;
}

export interface CookSession {
  recipeId: string;
  recipeTitle: string;
  recipeImageUrl: string | null;
  stepCount: number;
  stepIndex: number;
  servings: number;
  checkedIngredientIds: string[];
  /** Epoch ms the cook began — survives minimising, so elapsed time stays honest. */
  startedAt: number;
  updatedAt: number;
  /** Keyed by step index (string keys because this round-trips through JSON). */
  timers: Record<string, StoredTimer>;
  /** Step indices of finished timers not yet acknowledged. */
  finishedAlerts: number[];
}

export interface CookSessionInit {
  recipeId: string;
  recipeTitle: string;
  recipeImageUrl: string | null;
  stepCount: number;
  servings: number;
  timers: Array<{
    stepIndex: number;
    stepNumber: number;
    totalSeconds: number;
    label: string | null;
    preview: string;
  }>;
}

/** A finished timer awaiting acknowledgement, tagged with the cook it belongs to. */
export interface CookAlert {
  recipeId: string;
  recipeTitle: string;
  stepIndex: number;
  timer: TimerState;
}

interface CookSessionValue {
  /** The cook in the foreground — the one the mini bar represents. */
  session: CookSession | null;
  /** Every live cook, most recently used first. Dinner and dessert at once. */
  sessions: CookSession[];
  /** False until localStorage has been read — consumers should render defaults until then. */
  hydrated: boolean;
  timers: Map<number, TimerState>;
  /** Timers for any session, so the switcher can show each cook's countdown. */
  timersFor: (recipeId: string) => Map<number, TimerState>;
  /** Unacknowledged finished timers across every session. */
  alerts: CookAlert[];
  /** Starts a session, or resumes the existing one when it's for the same recipe. */
  startSession: (init: CookSessionInit) => void;
  /** Ends the given cook, or the active one when no id is passed. */
  endSession: (recipeId?: string) => void;
  /** Brings a cook to the foreground without touching the rest. */
  activateSession: (recipeId: string) => void;
  setStepIndex: (index: number, recipeId?: string) => void;
  setServings: (servings: number) => void;
  toggleIngredient: (ingredientId: string) => void;
  toggleTimer: (stepIndex: number) => void;
  resetTimer: (stepIndex: number) => void;
  dismissAlert: (stepIndex: number, recipeId?: string) => void;
}

const CookSessionContext = createContext<CookSessionValue | null>(null);

/** useLayoutEffect on the client, useEffect on the server — avoids the SSR warning. */
export const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function remainingOf(timer: StoredTimer, now: number): number {
  if (timer.done) return 0;
  if (timer.endsAt === null) return timer.pausedRemaining;
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

interface StoredState {
  sessions: CookSession[];
  activeRecipeId: string | null;
}

function isLive(s: CookSession | null | undefined): s is CookSession {
  return (
    !!s?.recipeId &&
    typeof s.updatedAt === "number" &&
    Date.now() - s.updatedAt <= STALE_AFTER_MS
  );
}

function readStored(): StoredState {
  const empty: StoredState = { sessions: [], activeRecipeId: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredState;
      const sessions = (parsed?.sessions ?? []).filter(isLive);
      const activeRecipeId = sessions.some((s) => s.recipeId === parsed?.activeRecipeId)
        ? parsed.activeRecipeId
        : sessions[0]?.recipeId ?? null;
      return { sessions, activeRecipeId };
    }

    // Migrate a v1 single-session cook so an in-progress dinner isn't lost.
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      const parsed = JSON.parse(legacy) as CookSession;
      if (isLive(parsed)) {
        return { sessions: [parsed], activeRecipeId: parsed.recipeId };
      }
    }
    return empty;
  } catch {
    return empty;
  }
}

export function CookSessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<CookSession[]>([]);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Restore before paint so resuming a cook doesn't flash step 1 first.
  useIsomorphicLayoutEffect(() => {
    const stored = readStored();
    setSessions(stored.sessions);
    setActiveRecipeId(stored.activeRecipeId);
    setHydrated(true);
  }, []);

  // Persist every change. Cheap enough to do synchronously — the payload is tiny
  // and only changes on user actions or timer completion, not on every tick.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (sessions.length) {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ sessions, activeRecipeId } satisfies StoredState)
        );
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage full or blocked — the session still works for this page life.
    }
  }, [sessions, activeRecipeId, hydrated]);

  const session = useMemo(
    () => sessions.find((s) => s.recipeId === activeRecipeId) ?? null,
    [sessions, activeRecipeId]
  );

  // Mutate one session in place, defaulting to whichever cook is in front.
  const updateFor = useCallback(
    (recipeId: string | null, fn: (prev: CookSession) => CookSession) => {
      if (!recipeId) return;
      setSessions((prev) =>
        prev.map((s) =>
          s.recipeId === recipeId ? { ...fn(s), updatedAt: Date.now() } : s
        )
      );
    },
    []
  );

  const update = useCallback(
    (fn: (prev: CookSession) => CookSession) => updateFor(activeRecipeId, fn),
    [updateFor, activeRecipeId]
  );

  const anyRunning = sessions.some((s) =>
    Object.values(s.timers).some((t) => !t.done && t.endsAt !== null)
  );

  // Tick only while something is counting down. Deadlines mean a throttled or
  // missed tick costs accuracy in the display, never in the timer itself.
  useEffect(() => {
    if (!anyRunning) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [anyRunning]);

  // Coming back to a backgrounded tab: catch up immediately rather than waiting
  // for the next tick, which may be a while off on mobile.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Promote elapsed timers to done and raise their alerts — across every cook,
  // so a dessert timer still fires while you're looking at the main course.
  useEffect(() => {
    const anyElapsed = sessions.some((s) =>
      Object.values(s.timers).some((t) => !t.done && t.endsAt !== null && t.endsAt <= now)
    );
    if (!anyElapsed) return;

    setSessions((prev) =>
      prev.map((s) => {
        const elapsed = Object.entries(s.timers)
          .filter(([, t]) => !t.done && t.endsAt !== null && t.endsAt <= now)
          .map(([key]) => Number(key));
        if (elapsed.length === 0) return s;

        const timers = { ...s.timers };
        for (const idx of elapsed) {
          const timer = timers[idx];
          if (!timer || timer.done) continue;
          timers[idx] = { ...timer, done: true, endsAt: null, pausedRemaining: 0 };
        }
        const newAlerts = elapsed.filter((idx) => !s.finishedAlerts.includes(idx));
        return {
          ...s,
          timers,
          finishedAlerts: [...s.finishedAlerts, ...newAlerts],
          updatedAt: Date.now(),
        };
      })
    );

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([300, 100, 300]);
    }
  }, [now, sessions]);

  // Chime immediately and then every few seconds while any alert is unacknowledged.
  const alertCount = sessions.reduce((n, s) => n + s.finishedAlerts.length, 0);
  useEffect(() => {
    if (alertCount === 0) return;
    playChime();
    const interval = setInterval(playChime, 6000);
    return () => clearInterval(interval);
  }, [alertCount]);

  const startSession = useCallback((init: CookSessionInit) => {
    setActiveRecipeId(init.recipeId);
    setSessions((prev) => {
      // Already cooking this one — resume in place, keeping step and timers.
      if (prev.some((s) => s.recipeId === init.recipeId)) return prev;

      const timers: Record<string, StoredTimer> = {};
      for (const t of init.timers) {
        timers[t.stepIndex] = {
          stepNumber: t.stepNumber,
          totalSeconds: t.totalSeconds,
          label: t.label,
          preview: t.preview,
          endsAt: null,
          pausedRemaining: t.totalSeconds,
          done: false,
        };
      }
      const startedAt = Date.now();
      // Newest first, so the switcher and mini bar lead with the latest cook.
      return [
        {
          recipeId: init.recipeId,
          recipeTitle: init.recipeTitle,
          recipeImageUrl: init.recipeImageUrl,
          stepCount: init.stepCount,
          stepIndex: 0,
          servings: init.servings,
          checkedIngredientIds: [],
          startedAt,
          updatedAt: startedAt,
          timers,
          finishedAlerts: [],
        },
        ...prev,
      ];
    });
  }, []);

  const endSession = useCallback(
    (recipeId?: string) => {
      setSessions((prev) => {
        const target = recipeId ?? activeRecipeId;
        const next = prev.filter((s) => s.recipeId !== target);
        // Ending the cook in front hands over to whatever else is still going.
        if (target === activeRecipeId) setActiveRecipeId(next[0]?.recipeId ?? null);
        return next;
      });
    },
    [activeRecipeId]
  );

  const activateSession = useCallback((recipeId: string) => {
    setActiveRecipeId(recipeId);
  }, []);

  const setStepIndex = useCallback(
    (index: number, recipeId?: string) =>
      updateFor(recipeId ?? activeRecipeId, (prev) => ({ ...prev, stepIndex: index })),
    [updateFor, activeRecipeId]
  );

  const setServings = useCallback(
    (servings: number) => update((prev) => ({ ...prev, servings })),
    [update]
  );

  const toggleIngredient = useCallback(
    (ingredientId: string) =>
      update((prev) => ({
        ...prev,
        checkedIngredientIds: prev.checkedIngredientIds.includes(ingredientId)
          ? prev.checkedIngredientIds.filter((id) => id !== ingredientId)
          : [...prev.checkedIngredientIds, ingredientId],
      })),
    [update]
  );

  const toggleTimer = useCallback(
    (stepIndex: number) => {
      // Starting/pausing is a user gesture — Safari's chance to unlock audio.
      unlockAudio();
      const at = Date.now();
      setNow(at);
      update((prev) => {
        const timer = prev.timers[stepIndex];
        if (!timer || timer.done) return prev;
        const next: StoredTimer =
          timer.endsAt === null
            ? { ...timer, endsAt: at + timer.pausedRemaining * 1000 }
            : { ...timer, endsAt: null, pausedRemaining: remainingOf(timer, at) };
        return { ...prev, timers: { ...prev.timers, [stepIndex]: next } };
      });
    },
    [update]
  );

  const resetTimer = useCallback(
    (stepIndex: number) => {
      unlockAudio();
      update((prev) => {
        const timer = prev.timers[stepIndex];
        if (!timer) return prev;
        return {
          ...prev,
          timers: {
            ...prev.timers,
            [stepIndex]: {
              ...timer,
              endsAt: null,
              pausedRemaining: timer.totalSeconds,
              done: false,
            },
          },
          finishedAlerts: prev.finishedAlerts.filter((i) => i !== stepIndex),
        };
      });
    },
    [update]
  );

  const dismissAlert = useCallback(
    (stepIndex: number, recipeId?: string) =>
      updateFor(recipeId ?? activeRecipeId, (prev) => ({
        ...prev,
        finishedAlerts: prev.finishedAlerts.filter((i) => i !== stepIndex),
      })),
    [updateFor, activeRecipeId]
  );

  const timerMapOf = useCallback(
    (target: CookSession | null | undefined) => {
      const map = new Map<number, TimerState>();
      if (!target) return map;
      for (const [key, timer] of Object.entries(target.timers)) {
        map.set(Number(key), {
          remaining: remainingOf(timer, now),
          running: timer.endsAt !== null && !timer.done,
          done: timer.done,
          totalSeconds: timer.totalSeconds,
          label: timer.label,
          stepNumber: timer.stepNumber,
          preview: timer.preview,
        });
      }
      return map;
    },
    [now]
  );

  const timers = useMemo(() => timerMapOf(session), [timerMapOf, session]);

  const timersFor = useCallback(
    (recipeId: string) => timerMapOf(sessions.find((s) => s.recipeId === recipeId)),
    [timerMapOf, sessions]
  );

  const alerts = useMemo<CookAlert[]>(() => {
    const out: CookAlert[] = [];
    for (const s of sessions) {
      const map = timerMapOf(s);
      for (const stepIndex of s.finishedAlerts) {
        const timer = map.get(stepIndex);
        if (timer) {
          out.push({
            recipeId: s.recipeId,
            recipeTitle: s.recipeTitle,
            stepIndex,
            timer,
          });
        }
      }
    }
    return out;
  }, [sessions, timerMapOf]);

  const value = useMemo<CookSessionValue>(
    () => ({
      session,
      sessions,
      hydrated,
      timers,
      timersFor,
      alerts,
      startSession,
      endSession,
      activateSession,
      setStepIndex,
      setServings,
      toggleIngredient,
      toggleTimer,
      resetTimer,
      dismissAlert,
    }),
    [
      session,
      sessions,
      hydrated,
      timers,
      timersFor,
      alerts,
      startSession,
      endSession,
      activateSession,
      setStepIndex,
      setServings,
      toggleIngredient,
      toggleTimer,
      resetTimer,
      dismissAlert,
    ]
  );

  return <CookSessionContext.Provider value={value}>{children}</CookSessionContext.Provider>;
}

export function useCookSession(): CookSessionValue {
  const ctx = useContext(CookSessionContext);
  if (!ctx) throw new Error("useCookSession must be used within a CookSessionProvider");
  return ctx;
}

/** Formats seconds as m:ss — shared by cooking mode and the mini bar. */
export function formatTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** The timer a glanceable summary should show: soonest to finish, done ones first. */
export function mostUrgentTimer(timers: Map<number, TimerState>): [number, TimerState] | null {
  const candidates = [...timers.entries()].filter(([, t]) => t.done || t.running);
  if (candidates.length === 0) return null;
  return candidates.sort(([, a], [, b]) => {
    if (a.done !== b.done) return a.done ? -1 : 1;
    return a.remaining - b.remaining;
  })[0];
}
