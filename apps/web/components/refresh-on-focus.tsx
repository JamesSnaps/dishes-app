"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the current route's server data when the app returns to the
 * foreground (tab focus / PWA resume) while online. iOS doesn't grant PWAs
 * true background execution, so refreshing on resume is the pragmatic
 * equivalent — you see fresh data the moment you reopen the app.
 *
 * Throttled so rapid focus/blur cycles don't hammer the server.
 *
 * `intervalMs` also refreshes on a timer while the page is visible, for
 * screens that change from elsewhere (another member, an order email).
 */
export function RefreshOnFocus({
  throttleMs = 15_000,
  intervalMs,
}: {
  throttleMs?: number;
  intervalMs?: number;
}) {
  const router = useRouter();
  const lastRefresh = useRef(0);

  useEffect(() => {
    function maybeRefresh() {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastRefresh.current < throttleMs) return;
      lastRefresh.current = now;
      router.refresh();
    }

    document.addEventListener("visibilitychange", maybeRefresh);
    window.addEventListener("focus", maybeRefresh);
    const timer = intervalMs ? setInterval(maybeRefresh, intervalMs) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", maybeRefresh);
      window.removeEventListener("focus", maybeRefresh);
      if (timer) clearInterval(timer);
    };
  }, [router, throttleMs, intervalMs]);

  return null;
}
