const CACHE_NAME = "dishes-shopping-v1";

self.addEventListener("install", (e) => {
  // Pre-cache the shopping page shell
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add("/shopping")).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  if (e.request.mode === "navigate" && url.pathname === "/shopping") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(e.request);
          return cached ?? Response.error();
        })
    );
  }
});

// Background Sync — flush any mutations queued while offline
self.addEventListener("sync", (e) => {
  if (e.tag === "sync-shopping") {
    e.waitUntil(flushPendingMutations());
  }
});

function openShoppingDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("dishes-shopping");
    req.onupgradeneeded = (e) => {
      // DB doesn't exist yet — nothing to flush
      e.target.transaction.abort();
      reject(new Error("DB not initialised"));
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function flushPendingMutations() {
  let db;
  try {
    db = await openShoppingDB();
  } catch {
    return;
  }

  const mutations = await new Promise((resolve, reject) => {
    const tx = db.transaction("pendingMutations", "readonly");
    const store = tx.objectStore("pendingMutations");
    const req = store.getAll();
    req.onsuccess = () =>
      resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });

  for (const mutation of mutations) {
    const res = await fetch(mutation.url, {
      method: mutation.method,
      headers: { "Content-Type": "application/json" },
      body: mutation.body || undefined,
    });

    if (res.ok || (res.status >= 400 && res.status < 500)) {
      // Drop on success or 4xx — don't block the queue on a gone/invalid item
      await new Promise((resolve, reject) => {
        const tx = db.transaction("pendingMutations", "readwrite");
        const store = tx.objectStore("pendingMutations");
        const req = store.delete(mutation.id);
        req.onsuccess = () => resolve(undefined);
        req.onerror = () => reject(req.error);
      });
    } else {
      // 5xx — throw to let Background Sync retry later
      throw new Error(`Server error ${res.status}`);
    }
  }
}
