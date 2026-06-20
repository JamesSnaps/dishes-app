"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * App-wide pill that appears when the device goes offline, so a stale meal plan
 * or recipe reads as "you're offline" rather than looking broken. Sits above the
 * mobile bottom nav (h-16 + safe area) and bottom-left clear of the desktop sidebar.
 */
export function OfflineIndicator() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 z-50 -translate-x-1/2 bottom-[calc(4rem+env(safe-area-inset-bottom,0px)+0.75rem)] lg:bottom-6 lg:left-6 lg:translate-x-0 flex items-center gap-2 rounded-full border border-amber-300 bg-amber-100/95 px-4 py-2 text-sm font-medium text-amber-900 shadow-lg backdrop-blur dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-300"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      Offline — showing saved data
    </div>
  );
}
