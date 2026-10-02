"use client";

import { useEffect } from "react";

// Stale-build errors: a chunk from the previous build is gone, or a Server
// Action ID from the previous build isn't on the new server.
const STALE_BUILD_RE =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|UnrecognizedActionError|Server Action "[^"]*" was not found on the server/i;

/**
 * Reload once if `message` means the page is running an old build. Returns
 * true when a reload was started. A short cooldown in sessionStorage prevents
 * reload loops if the error isn't fixed by a fresh build.
 */
export function reloadIfStaleBuild(message: string): boolean {
  if (!STALE_BUILD_RE.test(message)) return false;
  try {
    const last = Number(sessionStorage.getItem("chunkReloadAt") ?? 0);
    if (Date.now() - last < 10_000) return false; // already tried recently — avoid a loop
    sessionStorage.setItem("chunkReloadAt", String(Date.now()));
  } catch {
    // Storage blocked — still reload; the page will just lack loop protection.
  }
  window.location.reload();
  return true;
}

/**
 * After a deploy, a long-open PWA may try to lazy-load a JS/CSS chunk from the
 * previous build that no longer exists (the new service worker took over with
 * `skipWaiting`). That surfaces as a ChunkLoadError. Likewise a Server Action
 * called from the old bundle fails with UnrecognizedActionError, because action
 * IDs change between builds. Reload once to pick up the new build. Errors
 * caught by an error boundary don't reach these listeners, so the boundaries
 * call `reloadIfStaleBuild` themselves.
 */
export function ChunkReloadGuard() {
  useEffect(() => {
    function onError(e: ErrorEvent) {
      reloadIfStaleBuild(e.message ?? "");
    }
    function onRejection(e: PromiseRejectionEvent) {
      const reason = e.reason as { message?: string } | string | undefined;
      reloadIfStaleBuild(typeof reason === "string" ? reason : (reason?.message ?? ""));
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
