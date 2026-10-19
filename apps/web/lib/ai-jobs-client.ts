"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiJobKind, AiJobStatus } from "@/lib/ai-jobs";

// Client half of lib/ai-jobs.ts. A page starts a job with a server action,
// then waits on it here. Every job is also written to localStorage, so if the
// page unmounts (navigation) or the tab reloads, the app-wide tray
// (components/ai-jobs-tray.tsx) keeps polling and offers the result.
//
// "Claimed" jobs are ones a mounted page is waiting on itself — the tray stays
// out of the way for those and only steps in once the page lets go.

export type AiJobView<R = unknown, P = unknown> = {
  id: string;
  kind: AiJobKind;
  label: string;
  status: AiJobStatus;
  result?: R;
  progress?: P;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

export type TrackedAiJob = {
  jobId: string;
  kind: AiJobKind;
  label: string;
  startedAt: number;
  /** Page to return to for results only that page can show (concept ideas). */
  href?: string;
  /** Page-specific state needed to resume, e.g. the concierge's filters. */
  context?: unknown;
};

const STORAGE_KEY = "dishes-ai-jobs";
export const AI_JOBS_CHANGED = "dishes-ai-jobs-changed";
const POLL_MS = 1500;

const claimed = new Set<string>();

function notify() {
  window.dispatchEvent(new Event(AI_JOBS_CHANGED));
}

export function listTrackedAiJobs(): TrackedAiJob[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTracked(jobs: TrackedAiJob[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // private mode / quota — the page itself still gets its result
  }
  notify();
}

export function trackAiJob(job: TrackedAiJob) {
  const jobs = listTrackedAiJobs().filter((j) => j.jobId !== job.jobId);
  writeTracked([...jobs, job]);
}

export function untrackAiJob(jobId: string) {
  writeTracked(listTrackedAiJobs().filter((j) => j.jobId !== jobId));
}

export function isAiJobClaimed(jobId: string) {
  return claimed.has(jobId);
}

export async function fetchAiJob<R, P>(jobId: string): Promise<AiJobView<R, P> | "missing" | null> {
  try {
    const res = await fetch(`/api/ai-jobs/${jobId}`, {
      // JSON Accept so an expired Authelia session answers 401, not a login redirect.
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 404) return "missing";
    if (!res.ok) return null;
    return (await res.json()) as AiJobView<R, P>;
  } catch {
    return null; // offline / suspended — try again next tick
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** Check with `"error" in outcome`. */
export type AiJobOutcome<R> = { result: R } | { error: string };

/**
 * Waits for a job this page started. Resolves null when `signal` aborts (the
 * page unmounted) — the job stays tracked and the tray takes it from there.
 */
async function waitForAiJob<R, P>(
  jobId: string,
  signal: AbortSignal,
  onProgress?: (progress: P) => void
): Promise<AiJobOutcome<R> | null> {
  claimed.add(jobId);
  notify();
  try {
    while (!signal.aborted) {
      const job = await fetchAiJob<R, P>(jobId);
      if (signal.aborted) break;
      if (job === "missing") return { error: "That generation has expired. Please try again." };
      if (job) {
        if (job.progress !== undefined) onProgress?.(job.progress);
        if (job.status === "done") return { result: job.result as R };
        if (job.status === "failed") return { error: job.error ?? "Something went wrong." };
      }
      await sleep(POLL_MS, signal);
    }
    return null;
  } finally {
    claimed.delete(jobId);
    notify();
  }
}

/**
 * Start-and-wait for AI jobs from a component. `run` resolves with the outcome
 * while the component is mounted, or null once it has unmounted — callers
 * should simply return on null. Finished jobs are untracked here; abandoned
 * ones are left for the tray.
 */
export function useAiJobRunner() {
  const controllers = useRef(new Set<AbortController>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const live = controllers.current;
    return () => {
      mounted.current = false;
      for (const c of live) c.abort();
      live.clear();
    };
  }, []);

  const resume = useCallback(
    async <R, P = never>(jobId: string, onProgress?: (progress: P) => void): Promise<AiJobOutcome<R> | null> => {
      if (!mounted.current) return null;
      const controller = new AbortController();
      controllers.current.add(controller);
      try {
        const outcome = await waitForAiJob<R, P>(jobId, controller.signal, onProgress);
        if (outcome) untrackAiJob(jobId);
        return outcome;
      } finally {
        controllers.current.delete(controller);
      }
    },
    []
  );

  const run = useCallback(
    async <R, P = never>(
      start: Promise<{ jobId?: string; error?: string }>,
      meta: Omit<TrackedAiJob, "jobId" | "startedAt">,
      onProgress?: (progress: P) => void
    ): Promise<AiJobOutcome<R> | null> => {
      const started = await start;
      if (started.error || !started.jobId) return { error: started.error ?? "Couldn't start generating." };
      trackAiJob({ ...meta, jobId: started.jobId, startedAt: Date.now() });
      return resume<R, P>(started.jobId, onProgress);
    },
    [resume]
  );

  return { run, resume };
}

/**
 * A drop-in for `useTransition` around long AI waits. Never wait on a job
 * inside startTransition: React holds every navigation until a pending async
 * transition settles, so tapping another page mid-generation does nothing
 * until the AI answers — and then the answer is thrown away. Plain state
 * lets the navigation through at once; the page unmounts and the tray takes
 * over the job.
 */
export function useAsyncBusy(): [boolean, (task: () => Promise<void>) => void] {
  const [count, setCount] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const start = useCallback((task: () => Promise<void>) => {
    setCount((c) => c + 1);
    void task().finally(() => {
      if (mounted.current) setCount((c) => c - 1);
    });
  }, []);
  return [count > 0, start];
}
