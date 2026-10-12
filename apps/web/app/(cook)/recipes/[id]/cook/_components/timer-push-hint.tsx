"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellOff } from "lucide-react";

/**
 * Shown under a running timer when this device can't receive pushes, because
 * then a timer finishing with the phone locked makes no sound at all. Quiet
 * until it's relevant: nothing on devices that are already subscribed.
 */
export function TimerPushHint({ running }: { running: boolean }) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!running || subscribed !== null) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setSubscribed(false);
      return;
    }
    if (Notification.permission !== "granted") {
      setSubscribed(false);
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => setSubscribed(false));
  }, [running, subscribed]);

  if (!running || subscribed !== false) return null;

  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      <BellOff className="h-3.5 w-3.5 shrink-0" />
      <span>
        To hear timers with your phone locked,{" "}
        <Link href="/settings" className="font-medium text-foreground underline underline-offset-2">
          turn on notifications
        </Link>{" "}
        for this device.
      </span>
    </p>
  );
}
