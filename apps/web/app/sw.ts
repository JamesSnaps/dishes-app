/// <reference lib="webworker" />

// Service worker source — compiled to /public/sw.js by @serwist/next at build time.
// Serwist precaches the build output (JS/CSS chunks, static assets) and caches RSC
// navigations so the app shell and previously-visited pages load offline. The push,
// notification and background-sync handlers below are app-specific and run alongside it.

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, StaleWhileRevalidate, ExpirationPlugin } from "serwist";

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
  navigationPreload: true,
  // defaultCache includes Next.js-aware runtime caching: static assets, RSC payloads
  // (?_rsc / RSC header) via NetworkFirst, images, fonts, and API responses.
  runtimeCaching: [
    // Keep recipe photos cached generously so recipes and cook mode stay usable
    // offline for far longer than the default image window. Evaluated before
    // defaultCache, so it wins for the Next.js image-optimizer endpoint.
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname === "/_next/image",
      handler: new StaleWhileRevalidate({
        cacheName: "recipe-images",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 250,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            purgeOnQuotaError: true,
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
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

serwist.addEventListeners();

// One-time cleanup: drop the cache from the previous hand-rolled service worker.
// Serwist manages its own caches; this just reclaims space on already-installed clients.
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.delete("dishes-shopping-v1"));
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
