"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Check,
  Loader2,
  Palmtree,
  PencilLine,
  Plus,
  RotateCcw,
  SkipForward,
  Trash2,
  Undo2,
} from "lucide-react";
import { OrderDetailsDialog } from "@/components/deliveries/order-details-dialog";
import { Button, Input } from "@dishes/ui";
import { toast } from "@/hooks/use-toast";
import {
  addAwayPeriod,
  removeAwayPeriod,
  setDelivery,
  type DeliveryDayView,
} from "@/app/actions/deliveries";
import type { AwayPeriod } from "@dishes/db/schema";
import { shortDate } from "@/lib/deliveries/dates";

const DATE_INPUT =
  "appearance-none min-w-0 max-w-full text-left [&::-webkit-date-and-time-value]:text-left [&::-webkit-date-and-time-value]:min-h-[1.25rem]";

interface Props {
  upcoming: DeliveryDayView[];
  awayPeriods: AwayPeriod[];
  canEdit: boolean;
  today: string;
}

export function DeliveryCalendar({ upcoming, awayPeriods, canEdit, today }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editingDay, setEditingDay] = useState<DeliveryDayView | null>(null);

  const [awayFrom, setAwayFrom] = useState("");
  const [awayTo, setAwayTo] = useState("");
  const [awayLabel, setAwayLabel] = useState("");
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
    const btn =
      "h-8 px-2.5 text-xs font-semibold gap-1 border shadow-sm disabled:opacity-60";
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
          onClick={() =>
            run(d.date, () => setDelivery(d.date, d.regular ? "skipped" : "default"))
          }
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
    <div className="mt-6 space-y-6">
      {/* Upcoming deliveries */}
      <section className="rounded-xl border bg-gradient-to-br from-card to-teal-50/50 dark:to-teal-950/10 p-5 shadow-sm">
        <h2 className="font-semibold">Next four weeks</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Skip a week, add an extra delivery, or mark an order as placed.
        </p>

        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No deliveries coming up. Pick your delivery days above, or add a one-off below.
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
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        Ordered
                        {d.slot ? ` · ${d.slot}` : ""}
                        {d.total ? ` · £${d.total}` : ""}
                      </span>
                    ) : d.status === "skipped" ? (
                      d.awayLabel ? `Skipped — ${d.awayLabel}` : "Skipped"
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
                "Delivery added"
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

      {/* Holidays */}
      <section className="rounded-xl border bg-gradient-to-br from-card to-amber-50/60 dark:to-amber-950/10 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Palmtree className="h-4 w-4 text-amber-600" />
          <h2 className="font-semibold">Away</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Regular deliveries during a holiday are skipped, so you won&apos;t get reminders. The
          delivery before you go only has to cover the days until you leave.
        </p>

        {awayPeriods.length > 0 && (
          <ul className="mb-4 space-y-2">
            {awayPeriods.map((p) => {
              const key = `away-${p.from}-${p.to}`;
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 rounded-lg bg-amber-500/10 border border-amber-300/60 dark:border-amber-900/60 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{p.label || "Away"}</p>
                    <p className="text-xs text-muted-foreground">
                      {shortDate(p.from)} – {shortDate(p.to)}
                    </p>
                  </div>
                  {canEdit &&
                    (pending && busyKey === key ? (
                      <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => run(key, () => removeAwayPeriod(p.from, p.to))}
                        aria-label={`Remove ${p.label || "holiday"}`}
                        className="rounded-md p-1.5 text-amber-800 dark:text-amber-200 hover:bg-amber-500/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ))}
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(
                "away",
                async () => {
                  await addAwayPeriod({ from: awayFrom, to: awayTo, label: awayLabel });
                  setAwayFrom("");
                  setAwayTo("");
                  setAwayLabel("");
                },
                "Holiday added — deliveries skipped"
              );
            }}
            className="space-y-2"
          >
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-xs font-medium">From</span>
                <Input
                  type="date"
                  value={awayFrom}
                  min={today}
                  onChange={(e) => {
                    setAwayFrom(e.target.value);
                    if (!awayTo || awayTo < e.target.value) setAwayTo(e.target.value);
                  }}
                  required
                  className={DATE_INPUT}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium">To</span>
                <Input
                  type="date"
                  value={awayTo}
                  min={awayFrom || today}
                  onChange={(e) => setAwayTo(e.target.value)}
                  required
                  className={DATE_INPUT}
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={awayLabel}
                onChange={(e) => setAwayLabel(e.target.value)}
                placeholder="Label (optional) — e.g. Cornwall"
                maxLength={60}
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={!awayFrom || !awayTo || pending}
                className="gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shadow-md"
              >
                {pending && busyKey === "away" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add
              </Button>
            </div>
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
    </div>
  );
}
