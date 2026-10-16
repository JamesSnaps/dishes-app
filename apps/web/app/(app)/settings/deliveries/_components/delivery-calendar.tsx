"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Check,
  Loader2,
  PencilLine,
  RotateCcw,
  SkipForward,
  Trash2,
  Undo2,
} from "lucide-react";
import { OrderDetailsDialog } from "@/components/deliveries/order-details-dialog";
import { Button, Input } from "@dishes/ui";
import { toast } from "@/hooks/use-toast";
import { setDelivery, type DeliveryDayView } from "@/app/actions/deliveries";

const DATE_INPUT =
  "appearance-none min-w-0 max-w-full text-left [&::-webkit-date-and-time-value]:text-left [&::-webkit-date-and-time-value]:min-h-[1.25rem]";

interface Props {
  upcoming: DeliveryDayView[];
  canEdit: boolean;
  today: string;
}

export function DeliveryCalendar({ upcoming, canEdit, today }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editingDay, setEditingDay] = useState<DeliveryDayView | null>(null);

  const [extraDate, setExtraDate] = useState("");

  function run(key: string, action: () => Promise<void>, success?: string) {
    setBusyKey(key);
    startTransition(async () => {
      try {
        await action();
        if (success) toast({ title: success });
        router.refresh();
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Couldn't update deliveries",
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setBusyKey(null);
      }
    });
  }

  function rowActions(d: DeliveryDayView) {
    const busy = pending && busyKey === d.date;
    const btn = "h-8 px-2.5 text-xs font-semibold gap-1 border shadow-sm disabled:opacity-60";
    if (busy) return <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />;
    if (d.status === "ordered") {
      return (
        <div className="flex gap-1.5">
          <Button
            size="sm"
            onClick={() => setEditingDay(d)}
            aria-label={`Edit ${d.label} order details`}
            className={`${btn} bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white border-transparent`}
          >
            <PencilLine className="h-3.5 w-3.5" /> Details
          </Button>
          <Button
            size="sm"
            onClick={() => run(d.date, () => setDelivery(d.date, "scheduled"))}
            className={`${btn} bg-muted hover:bg-muted/70 text-foreground border-border`}
          >
            <Undo2 className="h-3.5 w-3.5" /> Not ordered
          </Button>
        </div>
      );
    }
    if (d.status === "skipped") {
      return (
        <Button
          size="sm"
          onClick={() => run(d.date, () => setDelivery(d.date, "scheduled"))}
          className={`${btn} bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-800`}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Restore
        </Button>
      );
    }
    return (
      <div className="flex gap-1.5">
        <Button
          size="sm"
          onClick={() => run(d.date, () => setDelivery(d.date, "ordered"), "Marked as ordered")}
          className={`${btn} bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white border-transparent`}
        >
          <Check className="h-3.5 w-3.5" /> Ordered
        </Button>
        <Button
          size="sm"
          onClick={() => run(d.date, () => setDelivery(d.date, d.regular ? "skipped" : "default"))}
          className={`${btn} bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800`}
        >
          {d.regular ? (
            <>
              <SkipForward className="h-3.5 w-3.5" /> Skip
            </>
          ) : (
            <>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <>
      <section className="rounded-xl border bg-gradient-to-br from-card to-teal-50/50 dark:to-teal-950/10 p-5 shadow-sm">
        <h2 className="font-semibold">Next four weeks</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Skip a week, add an extra delivery, or mark an order as placed.
        </p>

        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No deliveries coming up. Pick your delivery days in the schedule, or add a one-off
            below.
          </p>
        ) : (
          <ul className="divide-y divide-emerald-200/50 dark:divide-emerald-900/40">
            {upcoming.map((d) => (
              <li key={d.date} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p
                    className={`font-semibold ${
                      d.status === "skipped" ? "line-through text-muted-foreground" : ""
                    }`}
                  >
                    {d.label}
                    {!d.regular && (
                      <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 px-1.5 py-0.5">
                        One-off
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {d.status === "ordered" ? (
                      <>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          Ordered
                          {d.slot ? ` · ${d.slot}` : ""}
                          {d.total ? ` · £${d.total}` : ""}
                        </span>
                        {d.belowMinimum && (
                          <span className="font-semibold text-amber-700 dark:text-amber-400">
                            {" "}
                            · under {d.belowMinimum}
                          </span>
                        )}
                      </>
                    ) : d.status === "skipped" ? (
                      d.awayLabel ? (
                        `Skipped — ${d.awayLabel}`
                      ) : (
                        "Skipped"
                      )
                    ) : d.cutoffPassed ? (
                      "Order deadline passed"
                    ) : (
                      `Order by ${d.cutoffLabel}`
                    )}
                  </p>
                </div>
                {canEdit && rowActions(d)}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!extraDate) return;
              run(
                "extra",
                async () => {
                  await setDelivery(extraDate, "scheduled");
                  setExtraDate("");
                },
                "Delivery added",
              );
            }}
            className="mt-4 flex items-center gap-2"
          >
            <Input
              type="date"
              value={extraDate}
              min={today}
              onChange={(e) => setExtraDate(e.target.value)}
              aria-label="Extra delivery date"
              className={`flex-1 ${DATE_INPUT}`}
            />
            <Button
              type="submit"
              disabled={!extraDate || pending}
              className="gap-1.5 bg-gradient-to-r from-sky-600 to-teal-500 hover:from-sky-700 hover:to-teal-600 text-white border-0 shadow-md"
            >
              {pending && busyKey === "extra" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarPlus className="h-4 w-4" />
              )}
              Add delivery
            </Button>
          </form>
        )}
      </section>

      {editingDay && (
        <OrderDetailsDialog
          date={editingDay.date}
          label={editingDay.label}
          initial={editingDay}
          open
          onOpenChange={(open) => !open && setEditingDay(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}
