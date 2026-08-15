"use client";

import { useEffect, useState } from "react";
import { Cloud, CloudOff, RefreshCw, Check } from "lucide-react";
import { useSync, useOnline } from "@/components/providers/sync-provider";

/**
 * Small "is my data current?" affordance for the app shell.
 *
 * Deliberately quiet: a household app is usually idle and current, and a
 * status chip that shouts about it is noise. It only draws attention when
 * something is genuinely wrong — offline, or writes waiting to go up.
 */

function relativeTime(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SyncStatus({ className = "" }: { className?: string }) {
  const sync = useSync();
  const online = useOnline();

  // Sync state only exists after mount. Reserving the space keeps the server
  // and first client render identical, so hydration doesn't mismatch and the
  // nav doesn't shift when the status appears.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !sync?.engine) return <div className="h-4" aria-hidden />;

  const { status, lastSyncedAt, pending } = sync;
  const offline = !online || status === "offline";

  const { icon, label, tone } = offline
    ? {
        icon: <CloudOff className="h-3.5 w-3.5" />,
        label: pending ? `${pending} change${pending === 1 ? "" : "s"} waiting` : "Offline",
        tone: "text-amber-600 dark:text-amber-400",
      }
    : status === "syncing"
      ? {
          icon: <RefreshCw className="h-3.5 w-3.5 animate-spin" />,
          label: "Syncing…",
          tone: "text-muted-foreground",
        }
      : pending > 0
        ? {
            icon: <Cloud className="h-3.5 w-3.5" />,
            label: `${pending} to send`,
            tone: "text-muted-foreground",
          }
        : {
            icon: <Check className="h-3.5 w-3.5" />,
            label: lastSyncedAt ? `Synced ${relativeTime(lastSyncedAt)}` : "Synced",
            tone: "text-muted-foreground",
          };

  return (
    <button
      type="button"
      onClick={sync.sync}
      title={offline ? "Changes will sync when you reconnect" : "Sync now"}
      className={`flex items-center gap-1.5 text-xs transition-opacity hover:opacity-80 ${tone} ${className}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
