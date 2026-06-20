"use client";

import { useEffect } from "react";

const CHUNK_ERROR_RE = /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk/i;

/**
 * After a deploy, a long-open PWA may try to lazy-load a JS/CSS chunk from the
 * previous build that no longer exists (the new service worker took over with
 * `skipWaiting`). That surfaces as a ChunkLoadError. Reload once to pick up the
 * new build. A short cooldown in sessionStorage prevents reload loops if the
 * chunk is genuinely gone.
 */
export function ChunkReloadGuard() {
  useEffect(() => {
    function maybeReload(message: string) {
      if (!CHUNK_ERROR_RE.test(message)) return;
      const last = Number(sessionStorage.getItem("chunkReloadAt") ?? 0);
      if (Date.now() - last < 10_000) return; // already tried recently — avoid a loop
      sessionStorage.setItem("chunkReloadAt", String(Date.now()));
      window.location.reload();
    }

    function onError(e: ErrorEvent) {
      maybeReload(e.message ?? "");
    }
    function onRejection(e: PromiseRejectionEvent) {
      const reason = e.reason as { message?: string } | string | undefined;
      maybeReload(typeof reason === "string" ? reason : (reason?.message ?? ""));
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
