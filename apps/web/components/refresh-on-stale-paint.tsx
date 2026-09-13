"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Repaints the current route when the service worker discovers that the copy it
 * just served from cache was out of date.
 *
 * Pages and RSC payloads are served stale-while-revalidate (see `app/sw.ts`),
 * which is what makes navigation instant. For the screens backed by the sync
 * engine a stale shell is harmless — the local store fills in the real data.
 * For the ones that are still pure server renders it is not: /recipes/[id]
 * after an edit paints the pre-edit copy and nothing corrects it, which looks
 * exactly like the edit having been lost.
 *
 * The worker compares bodies on revalidation and posts PAGE_UPDATED when they
 * differ. Refreshing only when the message is for the route actually on screen
 * keeps a background revalidation of some other page from yanking this one out
 * from under the user.
 *
 * ── Why this is rate limited ────────────────────────────────────────────────
 *
 * `router.refresh()` re-fetches the RSC payload, that fetch goes back through
 * the worker's stale-while-revalidate route, and the revalidation compares
 * bodies again. `app/sw.ts` used to argue this could not loop, because the
 * refresh revalidates against a cache entry that now matches. That holds only
 * if the server render is byte-identical on two consecutive requests — and it
 * is not for any page carrying a relative timestamp, an ordering that depends
 * on `now()`, or a streamed response whose chunk boundaries move. When the
 * bodies always differ, every refresh triggers the next one.
 *
 * On iOS that loop is fatal rather than merely wasteful: Safari throws
 * "Attempt to use history.replaceState() more than 100 times per 10 seconds"
 * at the router, which escapes as an uncaught exception and takes the page down
 * with "Application error: a client-side exception has occurred". Observed in
 * the wild on /recipes/[id]/edit.
 *
 * So the correctness fix is the budget below, not a cleverer comparison: a
 * stale paint is worth at most a couple of repaints, and never worth a crash.
 */

/** Smallest gap between two repaints of the same route. */
const MIN_INTERVAL_MS = 5_000;
/** Repaints allowed per route visit before we stop believing the worker. */
const MAX_PER_ROUTE = 2;

export function RefreshOnStalePaint() {
  const router = useRouter();
  const pathname = usePathname();

  // Budget is per route visit: navigating away resets it, so a genuinely stale
  // page still repaints next time it is opened.
  const budget = useRef({ count: 0, lastAt: 0 });

  useEffect(() => {
    budget.current = { count: 0, lastAt: 0 };
  }, [pathname]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "PAGE_UPDATED" || !data.url) return;

      let updated: URL;
      try {
        updated = new URL(data.url);
      } catch {
        return;
      }

      if (updated.pathname !== pathname) return;

      const now = Date.now();
      if (budget.current.count >= MAX_PER_ROUTE) return;
      if (now - budget.current.lastAt < MIN_INTERVAL_MS) return;

      budget.current = { count: budget.current.count + 1, lastAt: now };
      router.refresh();
    }

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router, pathname]);

  return null;
}
