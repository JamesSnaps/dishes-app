"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Palmtree, PencilLine, Plus, Trash2, X } from "lucide-react";
import { Button, Input } from "@dishes/ui";
import { toast } from "@/hooks/use-toast";
import { addAwayPeriod, removeAwayPeriod, updateAwayPeriod } from "@/app/actions/deliveries";
import type { AwayPeriod } from "@dishes/db/schema";
import { shortDate } from "@/lib/deliveries/dates";

const DATE_INPUT =
  "appearance-none min-w-0 max-w-full text-left [&::-webkit-date-and-time-value]:text-left [&::-webkit-date-and-time-value]:min-h-[1.25rem]";

interface Props {
  awayPeriods: AwayPeriod[];
  canEdit: boolean;
  today: string;
}

const keyOf = (p: { from: string; to: string }) => `away-${p.from}-${p.to}`;

function nights(p: AwayPeriod): number {
  return Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
}

/** From / To / Label fields, shared by the add form and a row being edited. */
function PeriodFields({
  value,
  onChange,
  today,
  disabled,
}: {
  value: AwayPeriod;
  onChange: (next: AwayPeriod) => void;
  today: string;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
      <label className="space-y-1">
        <span className="text-xs font-medium">From</span>
        <Input
          type="date"
          value={value.from}
          min={today}
          onChange={(e) => {
            const from = e.target.value;
            onChange({ ...value, from, to: !value.to || value.to < from ? from : value.to });
          }}
          required
          disabled={disabled}
          className={DATE_INPUT}
        />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium">To</span>
        <Input
          type="date"
          value={value.to}
          min={value.from || today}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          required
          disabled={disabled}
          className={DATE_INPUT}
        />
      </label>
      <label className="col-span-2 space-y-1 sm:col-span-1">
        <span className="text-xs font-medium">Label (optional)</span>
        <Input
          value={value.label ?? ""}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          placeholder="e.g. Cornwall"
          maxLength={60}
          disabled={disabled}
        />
      </label>
    </div>
  );
}

export function AwayPeriods({ awayPeriods, canEdit, today }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<AwayPeriod>({ from: "", to: "", label: "" });
  /** The holiday being edited (by its saved key) and its working copy. */
  const [editing, setEditing] = useState<{ key: string; value: AwayPeriod } | null>(null);

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
          title: "Couldn't update holidays",
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setBusyKey(null);
      }
    });
  }

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Palmtree className="h-4 w-4 text-warning" />
        <h2 className="font-semibold">Holidays &amp; time away</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        Regular deliveries during a holiday are skipped, so you won&apos;t get reminders. The
        delivery before you go only has to cover the days until you leave.
      </p>

      {awayPeriods.length === 0 ? (
        <p className="mb-4 rounded-lg border border-dashed border-input px-3 py-2.5 text-sm text-muted-foreground">
          No holidays booked.{canEdit && " Add one below."}
        </p>
      ) : (
        <ul className="mb-4 space-y-2">
          {awayPeriods.map((p) => {
            const key = keyOf(p);
            const busy = pending && busyKey === key;
            const current = p.from <= today;

            if (editing?.key === key) {
              return (
                <li
                  key={key}
                  className="rounded-lg bg-warning-tint border border-transparent p-3"
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const value = editing.value;
                      run(
                        key,
                        async () => {
                          await updateAwayPeriod({ from: p.from, to: p.to }, value);
                          setEditing(null);
                        },
                        "Holiday updated",
                      );
                    }}
                    className="space-y-2"
                  >
                    <PeriodFields
                      value={editing.value}
                      onChange={(value) => setEditing({ key, value })}
                      today={current ? p.from : today}
                      disabled={busy}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setEditing(null)}
                        disabled={busy}
                        className="gap-1 bg-muted hover:bg-muted/70 text-foreground border border-border shadow-sm"
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busy || !editing.value.from || !editing.value.to}
                        className="gap-1 bg-warning text-card border-0 shadow-md"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Save
                      </Button>
                    </div>
                  </form>
                </li>
              );
            }

            return (
              <li
                key={key}
                className="flex items-center gap-3 rounded-lg bg-warning-tint border border-transparent px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {p.label || "Away"}
                    {current && (
                      <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide rounded-full bg-warning-tint text-warning px-1.5 py-0.5">
                        Now
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {shortDate(p.from)} – {shortDate(p.to)} · {nights(p)}{" "}
                    {nights(p) === 1 ? "day" : "days"}
                  </p>
                </div>
                {canEdit &&
                  (busy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-warning" />
                  ) : (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => setEditing({ key, value: { ...p, label: p.label ?? "" } })}
                        aria-label={`Edit ${p.label || "holiday"}`}
                        className="h-8 px-2.5 text-xs font-semibold gap-1 bg-warning-tint hover:bg-warning-tint text-warning border border-transparent shadow-sm"
                      >
                        <PencilLine className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          run(key, () => removeAwayPeriod(p.from, p.to), "Holiday removed")
                        }
                        aria-label={`Remove ${p.label || "holiday"}`}
                        className="h-8 px-2 bg-background/70 hover:bg-destructive/10 text-destructive border border-destructive/40 shadow-sm"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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
                await addAwayPeriod(draft);
                setDraft({ from: "", to: "", label: "" });
              },
              "Holiday added — deliveries skipped",
            );
          }}
          className="space-y-2 rounded-lg bg-background/50 border border-border p-3"
        >
          <p className="text-sm font-semibold">Add a holiday</p>
          <PeriodFields value={draft} onChange={setDraft} today={today} />
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!draft.from || !draft.to || pending}
              className="gap-1.5 bg-warning text-card border-0 shadow-md"
            >
              {pending && busyKey === "away" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add holiday
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
