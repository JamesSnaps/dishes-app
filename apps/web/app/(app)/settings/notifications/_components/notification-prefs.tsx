"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  Globe,
  Loader2,
  ShoppingCart,
  Smartphone,
  Timer,
  Trash2,
  Truck,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { removeMyNotificationDevice, setMyNotificationPref } from "@/app/actions/notification-settings";
import type { NotificationSettings } from "@/lib/services/notification-settings";
import type { NotificationType } from "@/lib/notification-types";

const ICONS: Record<NotificationType, LucideIcon> = {
  meal_plan: UtensilsCrossed,
  shopping_ready: ShoppingCart,
  shopping_updated: ShoppingCart,
  dinner: AlarmClock,
  cook_timers: Timer,
  delivery_deadline: Truck,
  delivery_orders: Truck,
};

const GROUP_TINT: Record<string, string> = {
  Household: "from-orange-500 to-rose-500",
  Cooking: "from-amber-500 to-orange-500",
  Deliveries: "from-emerald-500 to-teal-500",
};

export function NotificationPrefs({ settings }: { settings: NotificationSettings }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(
    () => Object.fromEntries(settings.types.map((t) => [t.id, t.enabled])) as Record<NotificationType, boolean>
  );
  const [pending, setPending] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(type: NotificationType) {
    const next = !enabled[type];
    setEnabled((e) => ({ ...e, [type]: next }));
    setPending(type);
    startTransition(async () => {
      try {
        await setMyNotificationPref(type, next);
      } catch {
        setEnabled((e) => ({ ...e, [type]: !next }));
        toast({ variant: "destructive", title: "Couldn't update that notification" });
      } finally {
        setPending(null);
      }
    });
  }

  function remove(id: string) {
    setPending(id);
    startTransition(async () => {
      try {
        await removeMyNotificationDevice(id);
        router.refresh();
      } catch {
        toast({ variant: "destructive", title: "Couldn't remove that device" });
      } finally {
        setPending(null);
      }
    });
  }

  const groups = [...new Set(settings.types.map((t) => t.group))];

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{group}</h2>
          <div className="overflow-hidden rounded-xl border bg-gradient-to-br from-card to-muted/40 shadow-sm divide-y">
            {settings.types
              .filter((t) => t.group === group)
              .map((t) => {
                const Icon = ICONS[t.id];
                const on = enabled[t.id];
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggle(t.id)}
                    disabled={pending === t.id}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60"
                  >
                    <span
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white shadow-sm bg-gradient-to-br ${
                        on ? GROUP_TINT[group] : "from-zinc-400 to-zinc-500 dark:from-zinc-600 dark:to-zinc-700"
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{t.title}</span>
                      <span className="block text-sm text-muted-foreground">{t.description}</span>
                    </span>
                    <span
                      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                        on ? "bg-gradient-to-r from-orange-500 to-rose-500" : "bg-zinc-300 dark:bg-zinc-700"
                      }`}
                    >
                      {pending === t.id ? (
                        <Loader2 className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />
                      ) : (
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                            on ? "left-[22px]" : "left-0.5"
                          }`}
                        />
                      )}
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      ))}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your devices</h2>
        {settings.devices.length === 0 ? (
          <p className="rounded-xl border bg-gradient-to-br from-card to-muted/40 px-4 py-3 text-sm text-muted-foreground shadow-sm">
            None yet. Enable notifications above, or allow them in the iPhone and iPad app.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-gradient-to-br from-card to-muted/40 shadow-sm divide-y">
            {settings.devices.map((d) => {
              const Icon = d.kind === "ios" ? Smartphone : Globe;
              return (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <Icon className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{d.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {d.kind === "ios" ? "Dishes app" : "Web"} · added{" "}
                      {new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(d.id)}
                    disabled={pending === d.id}
                    aria-label={`Stop notifications to ${d.name}`}
                    className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-destructive transition-colors hover:bg-destructive/20"
                  >
                    {pending === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
