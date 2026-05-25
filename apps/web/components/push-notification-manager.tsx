"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { Button } from "@dishes/ui";

type PermissionState = "unsupported" | "default" | "granted" | "denied";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

export function PushNotificationManager() {
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    setPermission(Notification.permission as PermissionState);

    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub))
    );
  }, []);

  async function subscribe() {
    setLoading(true);
    try {
      const res = await fetch("/api/push/vapid-public-key");
      if (!res.ok) throw new Error("Push not configured on server");
      const { publicKey } = await res.json();

      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") return;

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const { endpoint, keys } = sub.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, p256dh: keys.p256dh, auth: keys.auth }),
      });

      setSubscribed(true);
    } catch (err) {
      console.error("Push subscribe failed:", err);
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      console.error("Push unsubscribe failed:", err);
    } finally {
      setLoading(false);
    }
  }

  if (permission === "unsupported") return null;

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="font-medium">Push notifications</p>
        <p className="text-sm text-muted-foreground">
          {permission === "denied"
            ? "Blocked by browser — update site permissions to enable"
            : subscribed
              ? "Enabled on this device"
              : "Get notified about meal plans and shopping lists"}
        </p>
      </div>
      {permission !== "denied" && (
        <Button
          variant={subscribed ? "outline" : "default"}
          size="sm"
          onClick={subscribed ? unsubscribe : subscribe}
          disabled={loading}
          className="ml-4 shrink-0"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : subscribed ? (
            <>
              <BellOff className="mr-1.5 h-4 w-4" />
              Disable
            </>
          ) : (
            <>
              <Bell className="mr-1.5 h-4 w-4" />
              Enable
            </>
          )}
        </Button>
      )}
    </div>
  );
}
