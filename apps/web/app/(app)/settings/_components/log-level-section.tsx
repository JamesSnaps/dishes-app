"use client";

import { useState, useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@dishes/ui";
import { setLogLevel } from "@/app/actions/settings";
import { LOG_LEVEL_LABELS, type LogLevel } from "@/lib/log-levels";

interface Props {
  current: LogLevel;
}

export function LogLevelSection({ current }: Props) {
  const [value, setValue] = useState<LogLevel>(current);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleChange(next: string) {
    const level = next as LogLevel;
    setValue(level);
    setSaved(false);
    startTransition(async () => {
      await setLogLevel(level);
      setSaved(true);
    });
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Developer
      </h2>
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Server log level</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Controls verbosity of server-side logs. Changes take effect within 30 seconds.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saved && !pending && (
              <span className="text-xs text-muted-foreground">Saved</span>
            )}
            <Select value={value} onValueChange={handleChange} disabled={pending}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(LOG_LEVEL_LABELS) as [LogLevel, string][]).map(
                  ([level, label]) => (
                    <SelectItem key={level} value={level}>
                      {label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </section>
  );
}
