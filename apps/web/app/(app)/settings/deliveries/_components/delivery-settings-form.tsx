"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Loader2, Send, X } from "lucide-react";
import { Button, Input } from "@dishes/ui";
import { toast } from "@/hooks/use-toast";
import { saveDeliverySettings, setMyDeliveryReminders } from "@/app/actions/deliveries";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MAX_REMINDERS = 6;
/** iOS Safari renders time inputs natively; keep them inside narrow cards. */
const TIME_INPUT =
  "appearance-none min-w-0 max-w-full text-left [&::-webkit-date-and-time-value]:text-left [&::-webkit-date-and-time-value]:min-h-[1.25rem]";

interface Props {
  settings: {
    weekdays: number[];
    cutoffTime: string;
    cutoffDaysBefore: number;
    reminderTimes: string[];
    minOrderTotal: number | null;
    bookingReminderDays: number;
    timezone: string;
  };
  optedIn: boolean;
  isAdmin: boolean;
}

function deadlineSummary(weekdays: number[], cutoffTime: string, daysBefore: number): string {
  if (!weekdays.length) return "Pick your delivery days to see when orders close.";
  const parts = weekdays.map((d) => {
    const closes = DAY_NAMES[(d - daysBefore + 7) % 7];
    return `${DAY_NAMES[d]} → order by ${cutoffTime} ${daysBefore === 0 ? "the same day" : closes}`;
  });
  return parts.join(" · ");
}

export function DeliverySettingsForm({ settings, optedIn, isAdmin }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(optedIn);
  const [toggling, startToggle] = useTransition();
  const [saving, startSave] = useTransition();

  const [weekdays, setWeekdays] = useState<number[]>(settings.weekdays);
  const [cutoffTime, setCutoffTime] = useState(settings.cutoffTime);
  const [daysBefore, setDaysBefore] = useState(settings.cutoffDaysBefore);
  const [reminderTimes, setReminderTimes] = useState<string[]>(settings.reminderTimes);
  const [newTime, setNewTime] = useState("");
  const [minOrder, setMinOrder] = useState(
    settings.minOrderTotal != null ? String(settings.minOrderTotal) : ""
  );

  const [bookingDays, setBookingDays] = useState(settings.bookingReminderDays);

  const disabled = !isAdmin || saving;
  const [testing, setTesting] = useState(false);

  /** Push a preview of the next order's final reminder to this device. */
  async function sendTest() {
    setTesting(true);
    try {
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.ready : null;
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) {
        toast({
          variant: "destructive",
          title: "Notifications aren't on for this device",
          description: "Turn them on in Settings → Notifications, then try again.",
        });
        return;
      }
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, kind: "delivery" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) toast({ title: "Test reminder sent", description: "It should arrive in a moment." });
      else toast({ variant: "destructive", title: "Couldn't send", description: data.error });
    } catch {
      toast({ variant: "destructive", title: "Couldn't send a test reminder" });
    } finally {
      setTesting(false);
    }
  }

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    startToggle(async () => {
      try {
        await setMyDeliveryReminders(next);
        router.refresh();
      } catch {
        setEnabled(!next);
        toast({ variant: "destructive", title: "Couldn't update your reminder setting" });
      }
    });
  }

  function toggleDay(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  }

  function addTime() {
    if (!newTime || reminderTimes.includes(newTime)) return setNewTime("");
    setReminderTimes((prev) => [...prev, newTime].sort());
    setNewTime("");
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      try {
        await saveDeliverySettings({
          weekdays,
          cutoffTime,
          cutoffDaysBefore: daysBefore,
          reminderTimes,
          minOrderTotal: minOrder.trim() ? Number(minOrder) : null,
          bookingReminderDays: bookingDays,
        });
        toast({ title: "Delivery settings saved" });
        router.refresh();
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Couldn't save",
          description: err instanceof Error ? err.message : undefined,
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Personal opt-in */}
      <button
        type="button"
        onClick={toggle}
        disabled={toggling}
        role="switch"
        aria-checked={enabled}
        className={`w-full flex items-center gap-3 rounded-xl p-4 text-left shadow-sm transition-all ${
          enabled
            ? "bg-gradient-to-r from-emerald-600 to-teal-500 text-white"
            : "bg-gradient-to-br from-muted to-muted/40 border hover:from-muted/80"
        }`}
      >
        <BellRing className="h-5 w-5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold">Remind me before orders close</p>
          <p className={`text-sm ${enabled ? "text-white/85" : "text-muted-foreground"}`}>
            Sent to every device where you&apos;ve enabled notifications when something still
            needs doing, plus a last-orders reminder before the deadline. Other household
            members choose for themselves.
          </p>
        </div>
        <span
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
            enabled ? "bg-white/40" : "bg-zinc-300 dark:bg-zinc-700"
          }`}
        >
          {toggling ? (
            <Loader2 className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin" />
          ) : (
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                enabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          )}
        </span>
      </button>

      {enabled && (
        <div className="-mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <Button
            type="button"
            size="sm"
            onClick={sendTest}
            disabled={testing}
            className="gap-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300/70 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60 dark:text-emerald-100 dark:border-emerald-800 shadow-sm"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send me a test reminder
          </Button>
          <span className="text-xs text-muted-foreground">
            To this device, showing what the next order&apos;s final reminder would say.
          </span>
        </div>
      )}

      {/* Household schedule */}
      <form
        onSubmit={save}
        className="rounded-xl border bg-gradient-to-br from-card to-emerald-50/50 dark:to-emerald-950/10 p-5 shadow-sm space-y-5"
      >
        <div>
          <h2 className="font-semibold">Delivery schedule</h2>
          {!isAdmin && (
            <p className="text-sm text-muted-foreground">Only admins can change these.</p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Deliveries come every week on</p>
          <div className="grid grid-cols-7 gap-1.5">
            {DAYS.map((name, i) => {
              const on = weekdays.includes(i);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleDay(i)}
                  disabled={disabled}
                  aria-pressed={on}
                  className={`rounded-lg py-2 text-sm font-semibold transition-all disabled:opacity-60 ${
                    on
                      ? "bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-md"
                      : "bg-muted/60 hover:bg-muted border border-emerald-200/60 dark:border-emerald-900/50"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="cutoff-time" className="text-sm font-medium">
              Orders close at
            </label>
            <Input
              id="cutoff-time"
              type="time"
              value={cutoffTime}
              onChange={(e) => setCutoffTime(e.target.value)}
              disabled={disabled}
              required
              className={TIME_INPUT}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="days-before" className="text-sm font-medium">
              On
            </label>
            <select
              id="days-before"
              value={daysBefore}
              onChange={(e) => setDaysBefore(Number(e.target.value))}
              disabled={disabled}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value={0}>The delivery day</option>
              <option value={1}>The day before</option>
              <option value={2}>2 days before</option>
              <option value={3}>3 days before</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          {deadlineSummary(weekdays, cutoffTime, daysBefore)}
        </p>

        <div className="space-y-2">
          <p className="text-sm font-medium">Remind on the deadline day at</p>
          <div className="flex flex-wrap gap-2">
            {reminderTimes.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-500/20 to-teal-500/15 border border-emerald-300/60 dark:border-emerald-800/60 pl-3 pr-1.5 py-1 text-sm font-semibold tabular-nums"
              >
                {t}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setReminderTimes((prev) => prev.filter((x) => x !== t))}
                    disabled={saving}
                    aria-label={`Remove ${t}`}
                    className="rounded-full p-0.5 hover:bg-emerald-500/20"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            ))}
            {!reminderTimes.length && (
              <span className="text-sm text-muted-foreground">No reminders</span>
            )}
          </div>
          {isAdmin && reminderTimes.length < MAX_REMINDERS && (
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                disabled={saving}
                aria-label="New reminder time"
                className={`w-32 ${TIME_INPUT}`}
              />
              <Button
                type="button"
                onClick={addTime}
                disabled={!newTime || saving}
                className="bg-emerald-100 hover:bg-emerald-200 text-emerald-900 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60 dark:text-emerald-100 border border-emerald-300/70 dark:border-emerald-800"
              >
                Add time
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Times must be before {cutoffTime || "the deadline"}. The last one is sent as a
            &ldquo;last call&rdquo;. Uses the household timezone ({settings.timezone}) from
            Dinner reminders.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="booking-days" className="text-sm font-medium">
            Remind us to book if nothing&apos;s ordered
          </label>
          <select
            id="booking-days"
            value={bookingDays}
            onChange={(e) => setBookingDays(Number(e.target.value))}
            disabled={disabled}
            className="flex h-10 w-full sm:w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value={0}>Don&apos;t remind</option>
            {[2, 3, 4, 5, 7].map((d) => (
              <option key={d} value={d} disabled={d <= daysBefore}>
                {d} days before delivery
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {bookingDays > daysBefore
              ? `If no order has been logged ${bookingDays} days before a delivery, a "Book your delivery" reminder goes at ${
                  [...reminderTimes].sort()[0] ?? "09:00"
                }, so there's time to get a slot. `
              : bookingDays > 0
                ? "That's within the order deadline, so the deadline-day reminders cover it. "
                : ""}
            Each person turns it on under Settings → Notifications (it follows the switch above
            until they do).
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="min-order" className="text-sm font-medium">
            Warn if an order is under
          </label>
          <div className="relative w-40">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              £
            </span>
            <Input
              id="min-order"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
              disabled={disabled}
              placeholder="No minimum"
              className="pl-7"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            E.g. your supermarket&apos;s minimum spend. A placed order under it is flagged here and
            in the deadline-day reminders, so you can top it up before orders close.
          </p>
        </div>

        {isAdmin && (
          <Button
            type="submit"
            disabled={saving}
            className="bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white border-0 shadow-md"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save schedule
          </Button>
        )}
      </form>
    </div>
  );
}
