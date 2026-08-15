/// <reference lib="webworker" />

// Service worker source — compiled to /public/sw.js by @serwist/next at build time.
// Serwist precaches the build output (JS/CSS chunks, static assets) and caches RSC
// navigations so the app shell and previously-visited pages load offline. The push,
// notification and background-sync handlers below are app-specific and run alongside it.

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  ExpirationPlugin,
  NavigationRoute,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected by @serwist/next — the list of build assets to precache.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // Off deliberately. Navigation preload exists to hide latency for handlers
  // that go to the network first; the document handler below answers from cache,
  // so a preload would only start a request whose result is thrown away — and
  // it takes precedence over the route, which defeats the caching entirely.
  navigationPreload: false,
  // Routes are registered explicitly below rather than through `runtimeCaching`.
  // Precedence is registration order, and anything passed here is registered
  // during construction — which is what made the first attempt at this fail: the
  // navigation route could never be placed ahead of defaultCache's catch-all.
  //
  // When a never-visited route is opened offline (the request reaches the network
  // as a document load and fails), serve the precached offline page instead of a
  // dead tap.
  fallbacks: {
    entries: [
      {
        url: "/offline.html",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

// ── Paint from cache, revalidate behind it ───────────────────────────────────
//
// defaultCache serves pages and RSC payloads NetworkFirst, so every navigation
// waits for the server even when an identical copy is already cached — on a poor
// connection that is the whole cost of opening a screen (measured: 61 KB /
// ~830 ms for /meal-plan at 50 KB/s).
//
// Worse than slow: its final entry is a same-origin catch-all, and NetworkFirst
// only falls back to cache on a network *error*. A reverse proxy answering 502
// while the app server restarts is a perfectly valid response, so that route
// hands the error page straight to the user with a good copy sitting in the
// cache. The routes below take those requests stale-while-revalidate instead.
//
// Safe here because the data on these screens is no longer the RSC payload's
// job — the synced local store owns it, and the server render is only the
// `initial` fallback. A stale shell is replaced within one revalidation, and the
// store is authoritative in the meantime.
//
// The staleness that *would* bite is a shell from a previous deploy referencing
// chunks that no longer exist. That is handled on activate below.

/**
 * Tell the open tabs when a revalidation actually changed a page.
 *
 * The justification above — "the store owns the data, a stale shell is
 * harmless" — holds for the screens that read from the sync engine. It does not
 * hold for the ones that are still pure server renders: /recipes/[id] is the
 * important one. Edit a recipe and come back to it and stale-while-revalidate
 * paints the copy from before the edit, with nothing client-side that knows
 * better. It corrects itself on the *next* visit, which reads as the edit having
 * been silently reverted.
 *
 * So: compare the bodies, and when they differ, tell the page. The client
 * listener calls router.refresh(), which re-fetches the RSC payload — by then
 * the cache holds the new copy, so it paints correctly.
 *
 * Bodies rather than BroadcastUpdatePlugin's header comparison: that checks
 * etag / last-modified / content-length, and a streamed RSC response from Next
 * carries none of them, so every comparison would come back "same".
 *
 * No refresh loop: the refresh's own fetch revalidates against a cache entry
 * that now matches, which broadcasts nothing.
 */
const notifyOnChange = {
  async cacheDidUpdate({
    oldResponse,
    newResponse,
    request,
  }: {
    oldResponse?: Response | null;
    newResponse: Response;
    request: Request;
  }) {
    if (!oldResponse) return; // first time this URL was cached — nothing to revert

    const [before, after] = await Promise.all([
      oldResponse.clone().text(),
      newResponse.clone().text(),
    ]);
    if (before === after) return;

    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) {
      client.postMessage({ type: "PAGE_UPDATED", url: request.url });
    }
  },
};

const pageCache = new StaleWhileRevalidate({
  cacheName: "pages",
  plugins: [
    notifyOnChange,
    new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 }),
  ],
});

// NavigationRoute matches on the request being a navigation, which is what a
// document load actually is — `request.destination === "document"` in a plain
// matcher lost these to the catch-all.
serwist.registerRoute(
  new NavigationRoute(pageCache, {
    denylist: [/^\/api\//, /^\/_next\//],
  })
);

serwist.registerCapture(
  ({ request, url: { pathname }, sameOrigin }) =>
    sameOrigin && !pathname.startsWith("/api/") && request.headers.get("RSC") === "1",
  new StaleWhileRevalidate({
    cacheName: "pages-rsc",
    plugins: [
      notifyOnChange,
      new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 }),
    ],
  })
);

// Keep recipe photos cached generously so recipes and cook mode stay usable
// offline for far longer than the default image window.
serwist.registerCapture(
  ({ url, sameOrigin }) => sameOrigin && url.pathname === "/_next/image",
  new StaleWhileRevalidate({
    cacheName: "recipe-images",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 250,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// Everything else keeps Next.js-aware defaults: static assets, fonts, images,
// API responses. Registered last, so the routes above win where they overlap.
for (const entry of defaultCache) {
  serwist.registerCapture(entry.matcher, entry.handler, entry.method);
}

serwist.addEventListeners();

// On activate:
//
//  * Drop the page and RSC caches. A new worker means a new build, and those
//    caches hold shells that reference the previous build's chunks — serving
//    one stale-while-revalidate after a deploy would paint a page whose JS has
//    just been deleted from the precache. Clearing costs one network-first
//    load per screen after each deploy, and keeps every load after that instant.
//  * Drop the cache from the previous hand-rolled service worker. Serwist
//    manages its own; this just reclaims space on already-installed clients.
self.addEventListener("activate", (e) => {
  e.waitUntil(
    Promise.all([
      caches.delete("pages"),
      caches.delete("pages-rsc"),
      caches.delete("pages-rsc-prefetch"),
      caches.delete("dishes-shopping-v1"),
    ])
  );
});

// --- App-specific handlers (preserved from the original hand-rolled service worker) ---

self.addEventListener("push", (e) => {
  const data = e.data?.json() ?? {};
  e.waitUntil(
    self.registration.showNotification(data.title ?? "Dishes", {
      body: data.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url ?? "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/";
  e.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const existing = windowClients.find((c) => c.url === url && "focus" in c);
        if (existing) return existing.focus();
        return self.clients.openWindow(url);
      })
  );
});

// Background Sync — flush any shopping mutations queued while offline.
self.addEventListener("sync", (e: Event) => {
  const event = e as Event & { tag: string; waitUntil(p: Promise<unknown>): void };
  if (event.tag === "sync-shopping") {
    event.waitUntil(flushPendingMutations());
  }
});

// Periodic Background Sync — refresh the cached shopping list in the background
// so the app opens with current data. Supported on Chrome/Android & desktop;
// iOS doesn't implement it (refresh-on-resume covers that case instead).
self.addEventListener("periodicsync", (e: Event) => {
  const event = e as Event & { tag: string; waitUntil(p: Promise<unknown>): void };
  if (event.tag === "refresh-shopping") {
    event.waitUntil(
      (async () => {
        // Flush any edits queued while offline before pulling fresh server state,
        // so the refresh doesn't overwrite changes that haven't synced yet.
        try {
          await flushPendingMutations();
        } catch {
          // 5xx / network — leave queued for the next sync; still try to refresh.
        }
        await refreshShoppingCache();
      })()
    );
  }
});

async function refreshShoppingCache(): Promise<void> {
  let db: IDBDatabase;
  try {
    // Skip if the user has never opened the shopping list (DB not created yet).
    db = await openShoppingDB();
  } catch {
    return;
  }

  let data: { listId: string | null; items: unknown[] };
  try {
    const res = await fetch("/api/shopping/active");
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }

  if (!data.listId || !Array.isArray(data.items)) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");
    const store = tx.objectStore("items");
    // The cache only ever holds the active list, so replace it wholesale.
    store.clear();
    for (const item of data.items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

interface PendingMutation {
  id: number;
  url: string;
  method: string;
  body: string;
  createdAt: number;
}

function openShoppingDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("dishes-shopping");
    req.onupgradeneeded = (e) => {
      // DB doesn't exist yet — nothing to flush.
      (e.target as IDBOpenDBRequest).transaction?.abort();
      reject(new Error("DB not initialised"));
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function flushPendingMutations(): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openShoppingDB();
  } catch {
    return;
  }

  const mutations = await new Promise<PendingMutation[]>((resolve, reject) => {
    const tx = db.transaction("pendingMutations", "readonly");
    const store = tx.objectStore("pendingMutations");
    const req = store.getAll();
    req.onsuccess = () =>
      resolve((req.result as PendingMutation[]).sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });

  for (const mutation of mutations) {
    const res = await fetch(mutation.url, {
      method: mutation.method,
      headers: { "Content-Type": "application/json" },
      body: mutation.body || undefined,
    });

    if (res.ok || (res.status >= 400 && res.status < 500)) {
      // Drop on success or 4xx — don't block the queue on a gone/invalid item.
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("pendingMutations", "readwrite");
        const store = tx.objectStore("pendingMutations");
        const req = store.delete(mutation.id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } else {
      // 5xx — throw to let Background Sync retry later.
      throw new Error(`Server error ${res.status}`);
    }
  }
}
