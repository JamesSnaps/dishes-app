"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, Image, Info, CheckCheck } from "lucide-react";
import Link from "next/link";
import { cn } from "@dishes/ui";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@dishes/ui";
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
} from "@/app/actions/notifications";
import type { Notification } from "@dishes/db/schema";

const TYPE_ICON: Record<string, React.ElementType> = {
  image_generated: Image,
};

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const [, startTransition] = useTransition();

  async function refresh() {
    const count = await getUnreadCount();
    setUnread(count);
  }

  async function loadAndOpen() {
    setOpen(true);
    const [list] = await Promise.all([getNotifications()]);
    setItems(list);
    // Mark all read after opening
    startTransition(async () => {
      await markAllRead();
      setUnread(0);
    });
  }

  useEffect(() => {
    refresh();
    const onAdded = () => refresh();
    window.addEventListener("dishes-notification-added", onAdded);
    return () => window.removeEventListener("dishes-notification-added", onAdded);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          onClick={loadAndOpen}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
          aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-4 py-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <CheckCheck className="h-8 w-8 opacity-40" />
              <p className="text-sm">All caught up</p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Info;
                const isUnread = !n.readAt;
                return (
                  <li key={n.id}>
                    {n.recipeId ? (
                      <Link
                        href={`/recipes/${n.recipeId}`}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors",
                          isUnread && "bg-primary/5"
                        )}
                      >
                        <NotificationIcon Icon={Icon} unread={isUnread} />
                        <NotificationBody n={n} />
                      </Link>
                    ) : (
                      <div
                        className={cn(
                          "flex items-start gap-3 px-4 py-3",
                          isUnread && "bg-primary/5"
                        )}
                      >
                        <NotificationIcon Icon={Icon} unread={isUnread} />
                        <NotificationBody n={n} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NotificationIcon({
  Icon,
  unread,
}: {
  Icon: React.ElementType;
  unread: boolean;
}) {
  return (
    <div className="relative mt-0.5 shrink-0">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      {unread && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
      )}
    </div>
  );
}

function NotificationBody({ n }: { n: Notification }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium leading-snug">{n.title}</p>
      {n.body && (
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {n.body}
        </p>
      )}
      <p className="text-xs text-muted-foreground/60 mt-1">
        {formatRelativeTime(n.createdAt)}
      </p>
    </div>
  );
}
