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

const STORAGE_KEY = "dishes:cook-session:v1";

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

interface CookSessionValue {
  session: CookSession | null;
  /** False until localStorage has been read — consumers should render defaults until then. */
  hydrated: boolean;
  timers: Map<number, TimerState>;
  /** Starts a session, or resumes the existing one when it's for the same recipe. */
  startSession: (init: CookSessionInit) => void;
  endSession: () => void;
  setStepIndex: (index: number) => void;
  setServings: (servings: number) => void;
  toggleIngredient: (ingredientId: string) => void;
  toggleTimer: (stepIndex: number) => void;
  resetTimer: (stepIndex: number) => void;
  dismissAlert: (stepIndex: number) => void;
}

const CookSessionContext = createContext<CookSessionValue | null>(null);

/** useLayoutEffect on the client, useEffect on the server — avoids the SSR warning. */
export const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function remainingOf(timer: StoredTimer, now: number): number {
  if (timer.done) return 0;
  if (timer.endsAt === null) return timer.pausedRemaining;
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

function readStored(): CookSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookSession;
    if (!parsed?.recipeId || typeof parsed.updatedAt !== "number") return null;
    if (Date.now() - parsed.updatedAt > STALE_AFTER_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function CookSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<CookSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Restore before paint so resuming a cook doesn't flash step 1 first.
  useIsomorphicLayoutEffect(() => {
    setSession(readStored());
    setHydrated(true);
  }, []);

  // Persist every change. Cheap enough to do synchronously — the payload is tiny
  // and only changes on user actions or timer completion, not on every tick.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage full or blocked — the session still works for this page life.
    }
  }, [session, hydrated]);

  const update = useCallback((fn: (prev: CookSession) => CookSession) => {
    setSession((prev) => (prev ? { ...fn(prev), updatedAt: Date.now() } : prev));
  }, []);

  const anyRunning = session
    ? Object.values(session.timers).some((t) => !t.done && t.endsAt !== null)
    : false;

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

  // Promote elapsed timers to done and raise their alerts.
  useEffect(() => {
    if (!session) return;
    const elapsed = Object.entries(session.timers)
      .filter(([, t]) => !t.done && t.endsAt !== null && t.endsAt <= now)
      .map(([key]) => Number(key));
    if (elapsed.length === 0) return;

    update((prev) => {
      const timers = { ...prev.timers };
      for (const idx of elapsed) {
        const timer = timers[idx];
        if (!timer || timer.done) continue;
        timers[idx] = { ...timer, done: true, endsAt: null, pausedRemaining: 0 };
      }
      const newAlerts = elapsed.filter((idx) => !prev.finishedAlerts.includes(idx));
      return { ...prev, timers, finishedAlerts: [...prev.finishedAlerts, ...newAlerts] };
    });

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([300, 100, 300]);
    }
  }, [now, session, update]);

  // Chime immediately and then every few seconds while any alert is unacknowledged.
  const alertCount = session?.finishedAlerts.length ?? 0;
  useEffect(() => {
    if (alertCount === 0) return;
    playChime();
    const interval = setInterval(playChime, 6000);
    return () => clearInterval(interval);
  }, [alertCount]);

  const startSession = useCallback((init: CookSessionInit) => {
    setSession((prev) => {
      // Same recipe — resume rather than restart, keeping step, timers and ticks.
      if (prev?.recipeId === init.recipeId) return prev;
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
      return {
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
      };
    });
  }, []);

  const endSession = useCallback(() => setSession(null), []);

  const setStepIndex = useCallback(
    (index: number) => update((prev) => ({ ...prev, stepIndex: index })),
    [update]
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
    (stepIndex: number) =>
      update((prev) => ({
        ...prev,
        finishedAlerts: prev.finishedAlerts.filter((i) => i !== stepIndex),
      })),
    [update]
  );

  const timers = useMemo(() => {
    const map = new Map<number, TimerState>();
    if (!session) return map;
    for (const [key, timer] of Object.entries(session.timers)) {
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
  }, [session, now]);

  const value = useMemo<CookSessionValue>(
    () => ({
      session,
      hydrated,
      timers,
      startSession,
      endSession,
      setStepIndex,
      setServings,
      toggleIngredient,
      toggleTimer,
      resetTimer,
      dismissAlert,
    }),
    [
      session,
      hydrated,
      timers,
      startSession,
      endSession,
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
