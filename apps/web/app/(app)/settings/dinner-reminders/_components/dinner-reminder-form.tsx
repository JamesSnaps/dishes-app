"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Loader2 } from "lucide-react";
import { Button, Input } from "@dishes/ui";
import { toast } from "@/hooks/use-toast";
import {
  saveDinnerReminderSettings,
  setMyDinnerReminders,
} from "@/app/actions/dinner-reminders";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const LEAD_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];

interface Props {
  settings: {
    dinnerTime: string;
    dayTimes: Record<string, string>;
    leadMinutes: number;
    timezone: string;
  };
  optedIn: boolean;
  isAdmin: boolean;
}

export function DinnerReminderForm({ settings, optedIn, isAdmin }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(optedIn);
  const [toggling, startToggle] = useTransition();
  const [saving, startSave] = useTransition();

  const [dinnerTime, setDinnerTime] = useState(settings.dinnerTime);
  const [dayTimes, setDayTimes] = useState<Record<string, string>>(settings.dayTimes);
  const [leadMinutes, setLeadMinutes] = useState(settings.leadMinutes);
  const [timezone, setTimezone] = useState(settings.timezone);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, []);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    startToggle(async () => {
      try {
        await setMyDinnerReminders(next);
        router.refresh();
      } catch {
        setEnabled(!next);
        toast({ variant: "destructive", title: "Couldn't update your reminder setting" });
      }
    });
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      try {
        await saveDinnerReminderSettings({ dinnerTime, dayTimes, leadMinutes, timezone });
        toast({ title: "Dinner times saved" });
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
            ? "bg-gradient-to-r from-orange-500 to-rose-500 text-white"
            : "bg-gradient-to-br from-muted to-muted/40 border hover:from-muted/80"
        }`}
      >
        <BellRing className="h-5 w-5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold">Remind me to start dinner</p>
          <p className={`text-sm ${enabled ? "text-white/85" : "text-muted-foreground"}`}>
            Sent to every device where you&apos;ve enabled notifications. Other household
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

      {/* Household timing */}
      <form
        onSubmit={save}
        className="rounded-xl border bg-gradient-to-br from-card to-orange-50/40 dark:to-orange-950/10 p-5 shadow-sm space-y-5"
      >
        <div>
          <h2 className="font-semibold">Household dinner times</h2>
          {!isAdmin && (
            <p className="text-sm text-muted-foreground">Only admins can change these.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="dinner-time" className="text-sm font-medium">
              Dinner is usually at
            </label>
            <Input
              id="dinner-time"
              type="time"
              value={dinnerTime}
              onChange={(e) => setDinnerTime(e.target.value)}
              disabled={!isAdmin || saving}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lead" className="text-sm font-medium">
              Remind me this long before I need to start
            </label>
            <select
              id="lead"
              value={leadMinutes}
              onChange={(e) => setLeadMinutes(Number(e.target.value))}
              disabled={!isAdmin || saving}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {LEAD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "Exactly when to start" : `${m} minutes`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Different time on certain days (every week)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {DAY_NAMES.map((name, i) => {
              const value = dayTimes[String(i)] ?? "";
              return (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-24 text-sm text-muted-foreground">{name}</span>
                  <Input
                    type="time"
                    value={value}
                    placeholder={dinnerTime}
                    onChange={(e) =>
                      setDayTimes((prev) => {
                        const next = { ...prev };
                        if (e.target.value) next[String(i)] = e.target.value;
                        else delete next[String(i)];
                        return next;
                      })
                    }
                    disabled={!isAdmin || saving}
                    className="flex-1"
                  />
                  {value && isAdmin && (
                    <button
                      type="button"
                      onClick={() =>
                        setDayTimes((prev) => {
                          const next = { ...prev };
                          delete next[String(i)];
                          return next;
                        })
                      }
                      className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Leave a day blank to use {dinnerTime || "the usual time"}.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="tz" className="text-sm font-medium">
            Timezone
          </label>
          <Input
            id="tz"
            list="dinner-tz-list"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={!isAdmin || saving}
            required
          />
          <datalist id="dinner-tz-list">
            {timezones.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </div>

        {isAdmin && (
          <Button
            type="submit"
            disabled={saving}
            className="bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white border-0 shadow-md"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save dinner times
          </Button>
        )}
      </form>
    </div>
  );
}
