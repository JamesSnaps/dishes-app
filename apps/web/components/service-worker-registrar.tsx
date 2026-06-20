"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        // Periodic Background Sync — keep the shopping cache fresh in the
        // background where supported (Chrome/Android, desktop). Auto-granted by
        // site engagement; throws / no-ops on iOS, where refresh-on-resume applies.
        const r = reg as ServiceWorkerRegistration & {
          periodicSync?: {
            register(tag: string, opts: { minInterval: number }): Promise<void>;
          };
        };
        if (!r.periodicSync) return;
        try {
          const status = await navigator.permissions.query({
            name: "periodic-background-sync" as PermissionName,
          });
          if (status.state !== "granted") return;
          await r.periodicSync.register("refresh-shopping", {
            minInterval: 12 * 60 * 60 * 1000, // 12 hours
          });
        } catch {
          // Unsupported or not permitted — refresh-on-resume covers it.
        }
      })
      .catch(() => {
        // SW registration is best-effort
      });
  }, []);

  return null;
}
