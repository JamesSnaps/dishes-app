"use client";

import { APP_VERSION } from "@/lib/version";

/**
 * Ship a client-side crash to the server log.
 *
 * Fire-and-forget and failure-proof by design: this runs at the exact moment
 * the app is already broken, so it must not throw, must not retry, and must not
 * block whatever error UI is trying to render.
 */

/** One report per message per session — a render loop must not spam the log. */
const reported = new Set<string>();

/**
 * Next signals redirect() and notFound() by throwing. Those are control flow,
 * not crashes, and when one escapes into a floating promise it is reported as a
 * client exception on an otherwise perfectly successful save. Never worth a log
 * line: it buries the real crashes underneath it.
 */
function isFrameworkControlFlow(err: Error): boolean {
  const digest = (err as { digest?: unknown }).digest;
  const marker = typeof digest === "string" ? digest : err.message;
  return (
    marker.startsWith("NEXT_REDIRECT") ||
    marker === "NEXT_NOT_FOUND" ||
    marker === "NEXT_HTTP_ERROR_FALLBACK"
  );
}

export function reportClientError(
  error: unknown,
  source: string,
  extra?: { digest?: string }
): void {
  if (typeof window === "undefined") return;

  const err = error instanceof Error ? error : new Error(String(error));
  if (isFrameworkControlFlow(err)) return;

  const key = `${source}:${err.message}`;
  if (reported.has(key)) return;
  reported.add(key);

  const payload = JSON.stringify({
    message: err.message,
    stack: err.stack,
    digest: extra?.digest,
    url: window.location.pathname + window.location.search,
    source,
    // The version of the bundle that actually crashed. When it disagrees with
    // the server's own version the diagnosis is the report itself: a PWA left
    // open across a deploy, running JS the server no longer serves.
    appVersion: APP_VERSION,
    standalone:
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches,
  });

  send(payload);
}

/**
 * Reports that could not be delivered, held until the app next opens online.
 *
 * Without this a crash on the tube or in a dead-spot kitchen is simply lost —
 * and a PWA crashing while offline is exactly the case worth seeing. localStorage
 * rather than IndexedDB: it is synchronous, so it completes even if the page is
 * torn down on the next tick.
 */
const QUEUE_KEY = "dishes:pendingErrorReports";
const QUEUE_MAX = 20;

function enqueue(payload: string): void {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const queue: string[] = raw ? JSON.parse(raw) : [];
    queue.push(payload);
    // Keep the most recent: an old report from three deploys ago helps nobody.
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-QUEUE_MAX)));
  } catch {
    // Storage full or unavailable (private mode). Nothing further to try.
  }
}

function send(payload: string): void {
  try {
    // navigator.onLine is unreliable as a "yes, you have internet" signal, but a
    // definite false is trustworthy — and that is the case worth queueing for.
    if (navigator.onLine === false) {
      enqueue(payload);
      return;
    }

    // sendBeacon survives the page being torn down, which a crash often causes.
    // It returns false when the user agent refuses to queue the transfer; that
    // is a real delivery failure, so fall through to the queue.
    if (navigator.sendBeacon) {
      const queued = navigator.sendBeacon(
        "/api/client-error",
        new Blob([payload], { type: "application/json" })
      );
      if (queued) return;
      enqueue(payload);
      return;
    }

    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => enqueue(payload));
  } catch {
    // Reporting is best effort; never make a bad situation worse.
    enqueue(payload);
  }
}

/**
 * Deliver anything that was queued while offline. Called once on app start and
 * again whenever connectivity returns.
 */
export function flushPendingReports(): void {
  if (typeof window === "undefined" || navigator.onLine === false) return;

  let queue: string[];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return;
    queue = JSON.parse(raw) as string[];
    // Clear before sending: a report that fails again is re-queued by `send`,
    // and losing one beats a queue that can never drain.
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    try {
      localStorage.removeItem(QUEUE_KEY);
    } catch {
      /* nothing left to do */
    }
    return;
  }

  for (const payload of queue) send(payload);
}

/**
 * Catch what the React error boundaries don't: errors thrown outside render
 * (event handlers, effects, async work) and unhandled promise rejections.
 * Those are the ones that surface as a bare "client-side exception".
 */
export function installGlobalErrorReporting(): () => void {
  const onError = (e: ErrorEvent) =>
    reportClientError(e.error ?? e.message, "window.onerror");
  const onRejection = (e: PromiseRejectionEvent) =>
    reportClientError(e.reason, "unhandledrejection");

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("online", flushPendingReports);

  flushPendingReports();

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("online", flushPendingReports);
  };
}
