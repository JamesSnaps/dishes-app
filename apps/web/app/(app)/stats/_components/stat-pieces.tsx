import type { ReactNode } from "react";
import { cn } from "@dishes/ui";

/**
 * Small, dependency-free chart pieces for the Stats page. Server-rendered;
 * hover detail comes from native tooltips (`title`) and every chart has its
 * numbers visible or in a table, so nothing relies on colour or hover alone.
 */

export function Section({
  title,
  icon,
  description,
  children,
  className,
}: {
  title: string;
  icon?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("break-inside-avoid rounded-2xl border bg-card/80 p-4 shadow-sm lg:p-5 print:shadow-none", className)}>
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {icon}
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function StatTile({
  value,
  label,
  hint,
  tone = "neutral",
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  tone?: "neutral" | "rose" | "orange" | "violet" | "emerald";
}) {
  const tones = {
    neutral: "from-muted/60 to-muted/20",
    rose: "from-rose-100 to-pink-50 dark:from-rose-950/50 dark:to-pink-950/20",
    orange: "from-orange-100 to-amber-50 dark:from-orange-950/50 dark:to-amber-950/20",
    violet: "from-violet-100 to-fuchsia-50 dark:from-violet-950/50 dark:to-fuchsia-950/20",
    emerald: "from-emerald-100 to-teal-50 dark:from-emerald-950/50 dark:to-teal-950/20",
  };
  return (
    <div className={cn("rounded-xl bg-gradient-to-br p-3 shadow-sm", tones[tone])} title={hint}>
      <div className="text-2xl font-bold leading-tight tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

/** Horizontal bars, one series. Label left, value right, bar between. */
export function BarList({
  rows,
  barClassName = "bg-primary",
  valueSuffix = "",
}: {
  rows: { key: string; label: ReactNode; value: number; tooltip?: string }[];
  barClassName?: string;
  valueSuffix?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="group" title={r.tooltip ?? `${r.value}${valueSuffix}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {r.value}
              {valueSuffix}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className={cn("h-2 rounded-full transition-opacity group-hover:opacity-80", barClassName)}
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Vertical columns over time, one series, as a share (0–1). Columns with no
 * data render as an empty track rather than a zero bar, so "no figures" never
 * reads as "0%".
 */
export function ShareColumns({
  columns,
  barClassName = "bg-rose-500",
  emptyLabel = "No data",
}: {
  columns: { key: string; label: string; share: number | null; tooltip: string }[];
  barClassName?: string;
  emptyLabel?: string;
}) {
  // Label every column when there are few; otherwise every other, to avoid collisions.
  const labelEvery = columns.length > 8 ? 2 : 1;
  return (
    <div>
      <div className="relative flex h-40 items-end gap-1.5 border-b border-border/70">
        {[0.25, 0.5, 0.75].map((y) => (
          <div
            key={y}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/50"
            style={{ bottom: `${y * 100}%` }}
          />
        ))}
        {columns.map((c) => (
          <div
            key={c.key}
            className="group relative flex h-full flex-1 items-end"
            title={c.share === null ? `${c.tooltip} — ${emptyLabel}` : c.tooltip}
          >
            {c.share === null ? (
              <div className="h-full w-full rounded-t-[4px] border border-dashed border-border/60" />
            ) : (
              <div
                className={cn("w-full rounded-t-[4px] transition-opacity group-hover:opacity-80", barClassName)}
                style={{ height: `${Math.max(2, c.share * 100)}%` }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {columns.map((c, i) => (
          <div key={c.key} className="flex-1 truncate text-center text-[10px] text-muted-foreground">
            {i % labelEvery === 0 ? c.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The numbers behind a chart, for anyone who'd rather read than hover. */
export function DataTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="mt-3 text-sm print:hidden">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
        Show as table
      </summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-muted">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t">
                {row.map((cell, j) => (
                  <td key={j} className="px-2 py-1.5 tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
