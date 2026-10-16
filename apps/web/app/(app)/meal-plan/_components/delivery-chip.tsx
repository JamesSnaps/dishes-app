"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Check,
  Loader2,
  PencilLine,
  RotateCcw,
  Settings2,
  SkipForward,
  Truck,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dishes/ui";
import { toast } from "@/hooks/use-toast";
import {
  getWeekDeliveryPanel,
  setDelivery,
  type DeliveryDayView,
  type WeekDeliveryPanel,
} from "@/app/actions/deliveries";
import { OrderDetailsDialog } from "@/components/deliveries/order-details-dialog";

/**
 * Deliveries for the visible week, loaded per week like dinner times (the
 * planner changes weeks from the local store without a server render).
 * `refreshKey` changes whenever the plan or list changes, so the "what's still
 * to do" checklist follows edits. Offline, the panel simply doesn't show.
 */
export function useWeekDeliveries(weekStartDate: string, refreshKey: string) {
  const [panel, setPanel] = useState<WeekDeliveryPanel | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getWeekDeliveryPanel(weekStartDate)
      .then((p) => {
        if (!cancelled) setPanel(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [weekStartDate, refreshKey, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { panel, reload };
}

const STATUS_STYLE: Record<DeliveryDayView["status"], string> = {
  scheduled:
    "bg-gradient-to-r from-teal-500/20 to-emerald-500/15 text-teal-800 dark:text-teal-200 border-teal-300/70 dark:border-teal-800",
  ordered:
    "bg-gradient-to-r from-emerald-600 to-teal-500 text-white border-transparent shadow-sm",
  skipped: "bg-muted text-muted-foreground border-border line-through",
};

/** Delivery badge on the selected day's heading, with its quick actions. */
export function DeliveryChip({
  day,
  canEdit,
  onChanged,
}: {
  day: DeliveryDayView;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  // Open after the menu has closed, so the menu's focus handling doesn't
  // fight the dialog's.
  const openEditor = () => setTimeout(() => setEditing(true), 0);

  function change(target: "ordered" | "scheduled" | "skipped" | "default", success: string) {
    startTransition(async () => {
      try {
        await setDelivery(day.date, target);
        toast({ title: success });
        onChanged();
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Couldn't update the delivery",
          description: err instanceof Error ? err.message : undefined,
        });
      }
    });
  }

  const label =
    day.status === "ordered" ? (day.slot ? `Delivery ${day.slot}` : "Ordered") : day.status === "skipped" ? "No delivery" : "Delivery";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-90 ${STATUS_STYLE[day.status]}`}
            aria-label={`Delivery: ${label}`}
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Truck className="h-3 w-3" />}
            {label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <p className="font-semibold">{day.label} delivery</p>
            <p className="text-xs text-muted-foreground">
              {day.status === "ordered"
                ? [day.slot, day.total ? `£${day.total}` : null].filter(Boolean).join(" · ") ||
                  "Order placed"
                : day.status === "skipped"
                  ? day.awayLabel
                    ? `Skipped: ${day.awayLabel}`
                    : "Skipped this week"
                  : day.cutoffPassed
                    ? "Order deadline passed"
                    : `Order by ${day.cutoffLabel}`}
            </p>
          </DropdownMenuLabel>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              {day.status === "scheduled" && (
                <>
                  <DropdownMenuItem onSelect={() => change("ordered", "Marked as ordered")}>
                    <Check className="mr-2 h-4 w-4 text-emerald-600" /> Mark as ordered
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={openEditor}>
                    <PencilLine className="mr-2 h-4 w-4 text-emerald-600" /> Ordered — add slot &amp; total
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      change(day.regular ? "skipped" : "default", "Delivery skipped")
                    }
                  >
                    <SkipForward className="mr-2 h-4 w-4 text-amber-600" />
                    {day.regular ? "Skip this delivery" : "Remove this delivery"}
                  </DropdownMenuItem>
                </>
              )}
              {day.status === "ordered" && (
                <>
                  <DropdownMenuItem onSelect={openEditor}>
                    <PencilLine className="mr-2 h-4 w-4 text-emerald-600" /> Edit order details
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => change("scheduled", "Order unmarked")}>
                    <Undo2 className="mr-2 h-4 w-4" /> Not ordered yet
                  </DropdownMenuItem>
                </>
              )}
              {day.status === "skipped" && (
                <DropdownMenuItem onSelect={() => change("scheduled", "Delivery restored")}>
                  <RotateCcw className="mr-2 h-4 w-4 text-emerald-600" /> Restore delivery
                </DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/deliveries">
              <Settings2 className="mr-2 h-4 w-4" /> Delivery settings
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {canEdit && (
        <OrderDetailsDialog
          date={day.date}
          label={day.label}
          initial={day}
          open={editing}
          onOpenChange={setEditing}
          onSaved={onChanged}
        />
      )}
    </>
  );
}
