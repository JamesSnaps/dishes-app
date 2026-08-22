"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Warm the RSC payloads for a set of routes shortly after load.
 *
 * The nav items are `<button onClick={requestNavigation}>` rather than `<Link>`,
 * so that unsaved-changes can intercept a navigation before it happens. The
 * side effect of that is no prefetching: `<Link>` warms routes in the viewport,
 * a button does not. So every nav destination was being fetched at tap time,
 * every first time — and the service worker clears its page caches on activate
 * (a stale shell can reference chunks a new build deleted), which means the
 * first tap on each screen after a deploy went to the network.
 *
 * Prefetching once per session turns those taps into cache hits.
 *
 * Two deliberate constraints:
 *
 *  - Idle, not on mount. Prefetching eight routes while the current page is
 *    still fetching its own chunks would compete with the thing the user is
 *    actually looking at.
 *  - Not on a metered or very slow connection. On 2g the prefetch *is* the
 *    contention this was meant to remove, and Data Saver is an explicit ask to
 *    stop doing this kind of thing.
 */
type NetworkInformation = {
  effectiveType?: string;
  saveData?: boolean;
};

function shouldPrefetch(): boolean {
  const connection = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection;

  if (!connection) return true; // Safari/Firefox don't expose it — assume fine
  if (connection.saveData) return false;

  return connection.effectiveType !== "2g" && connection.effectiveType !== "slow-2g";
}

function whenIdle(fn: () => void): () => void {
  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  ).requestIdleCallback;

  if (ric) {
    const id = ric(fn, { timeout: 3000 });
    return () => (window as unknown as { cancelIdleCallback?: (i: number) => void })
      .cancelIdleCallback?.(id);
  }

  // Safari has no requestIdleCallback; a short delay is close enough here.
  const timer = setTimeout(fn, 1500);
  return () => clearTimeout(timer);
}

export function usePrefetchRoutes(hrefs: string[]): void {
  const router = useRouter();

  // Joined so the effect doesn't re-run when a caller rebuilds the array.
  const key = hrefs.join("|");

  useEffect(() => {
    if (!key || !shouldPrefetch()) return;

    return whenIdle(() => {
      for (const href of key.split("|")) router.prefetch(href);
    });
  }, [key, router]);
}
