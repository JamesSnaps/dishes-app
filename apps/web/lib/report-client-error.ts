"use client";

/**
 * Ship a client-side crash to the server log.
 *
 * Fire-and-forget and failure-proof by design: this runs at the exact moment
 * the app is already broken, so it must not throw, must not retry, and must not
 * block whatever error UI is trying to render.
 */

/** One report per message per session — a render loop must not spam the log. */
const reported = new Set<string>();

export function reportClientError(
  error: unknown,
  source: string,
  extra?: { digest?: string }
): void {
  if (typeof window === "undefined") return;

  const err = error instanceof Error ? error : new Error(String(error));
  const key = `${source}:${err.message}`;
  if (reported.has(key)) return;
  reported.add(key);

  const payload = JSON.stringify({
    message: err.message,
    stack: err.stack,
    digest: extra?.digest,
    url: window.location.pathname + window.location.search,
    source,
  });

  try {
    // sendBeacon survives the page being torn down, which a crash often causes.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/client-error",
        new Blob([payload], { type: "application/json" })
      );
      return;
    }
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting is best effort; never make a bad situation worse.
  }
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

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
