"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { Button } from "@dishes/ui";
import { toast } from "@/hooks/use-toast";

type PermissionState = "unsupported" | "default" | "granted" | "denied";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

export function PushNotificationManager({
  vapidPublicKey,
}: {
  /** Server's VAPID public key, or null when push isn't configured server-side. */
  vapidPublicKey: string | null;
}) {
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

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
      // iOS/WebKit only shows the permission prompt while the tap's transient
      // activation is still live. Any await before this (e.g. fetching the VAPID
      // key) drops the activation and the prompt silently never appears — so
      // request permission FIRST, before any other async work.
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") {
        toast({
          title: "Notifications not enabled",
          description:
            perm === "denied"
              ? "Permission was blocked. Enable notifications for this app in iOS Settings, then try again."
              : "Permission wasn't granted. Tap Enable and choose Allow.",
        });
        return;
      }

      // Key comes from the server at render time; the Enable button only renders
      // when it's present, so this guard is just for type-narrowing.
      if (!vapidPublicKey) throw new Error("Push isn't configured on the server.");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
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
      toast({
        title: "Notifications enabled",
        description: "You'll get push alerts on this device.",
      });
    } catch (err) {
      console.error("Push subscribe failed:", err);
      toast({
        variant: "destructive",
        title: "Couldn't enable notifications",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
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
      toast({
        variant: "destructive",
        title: "Couldn't disable notifications",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) throw new Error("No active subscription on this device.");

      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to send test notification.");
      }

      toast({
        title: "Test notification sent",
        description: "It should appear on this device in a moment.",
      });
    } catch (err) {
      console.error("Push test failed:", err);
      toast({
        variant: "destructive",
        title: "Couldn't send test",
        description: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setTesting(false);
    }
  }

  if (permission === "unsupported") return null;

  // Push isn't configured server-side — show why instead of an Enable button
  // that can only fail. (Reflects whether VAPID keys reached the running app.)
  if (!vapidPublicKey) {
    return (
      <div>
        <p className="font-medium">Push notifications</p>
        <p className="text-sm text-muted-foreground">
          Not configured on the server. Set <code>VAPID_SUBJECT</code>,{" "}
          <code>VAPID_PUBLIC_KEY</code> and <code>VAPID_PRIVATE_KEY</code> in the
          app&apos;s environment and restart it.
        </p>
      </div>
    );
  }

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
        <div className="ml-4 flex shrink-0 items-center gap-2">
          {subscribed && (
            <Button
              variant="default"
              size="sm"
              onClick={sendTest}
              disabled={testing || loading}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <BellRing className="mr-1.5 h-4 w-4" />
                  Test
                </>
              )}
            </Button>
          )}
          <Button
            variant={subscribed ? "outline" : "default"}
            size="sm"
            onClick={subscribed ? unsubscribe : subscribe}
            disabled={loading || testing}
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
        </div>
      )}
    </div>
  );
}
