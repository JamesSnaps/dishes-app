"use client";

import { useEffect } from "react";
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
 */
export function RefreshOnStalePaint() {
  const router = useRouter();
  const pathname = usePathname();

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
      router.refresh();
    }

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router, pathname]);

  return null;
}
