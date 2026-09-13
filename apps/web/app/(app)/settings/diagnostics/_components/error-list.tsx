"use client";

import { useState } from "react";
import { ChevronDown, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge, cn } from "@dishes/ui";
import type { ClientErrorRow } from "@/app/actions/diagnostics";

interface Props {
  errors: ClientErrorRow[];
  /** The version this server is running, to compare each report against. */
  serverVersion: string;
}

function timeAgo(date: Date) {
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Turn the raw user-agent into the one fact that matters: which device. */
function device(userAgent: string | null) {
  if (!userAgent) return null;
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  return "Other";
}

export function ErrorList({ errors, serverVersion }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  if (errors.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50 to-teal-50 p-8 text-center dark:border-emerald-900/50 dark:from-emerald-950/40 dark:to-teal-950/30">
        <ShieldCheck className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        <p className="mt-3 font-semibold">No crashes recorded</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Reports land here automatically the moment a device hits a client-side
          error. Nothing to see is good news.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {errors.map((e) => {
        const isOpen = open === e.id;
        // The single most useful signal on this page: a report from a bundle the
        // server no longer serves is a PWA that sat open across a deploy, not a
        // bug in the screen it crashed on.
        const stale = Boolean(e.appVersion && e.appVersion !== serverVersion);

        return (
          <div
            key={e.id}
            className={cn(
              "overflow-hidden rounded-xl border shadow-sm transition-colors",
              stale
                ? "border-amber-200/70 bg-gradient-to-br from-amber-50 to-orange-50 dark:border-amber-900/50 dark:from-amber-950/40 dark:to-orange-950/20"
                : "border-rose-200/70 bg-gradient-to-br from-rose-50 to-red-50 dark:border-rose-900/50 dark:from-rose-950/40 dark:to-red-950/20"
            )}
          >
            <button
              onClick={() => setOpen(isOpen ? null : e.id)}
              className="flex w-full items-start gap-3 p-4 text-left"
            >
              <TriangleAlert
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  stale
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-rose-600 dark:text-rose-400"
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium leading-snug">{e.message}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  {e.url && (
                    <Badge variant="secondary" className="font-mono">
                      {e.url}
                    </Badge>
                  )}
                  {device(e.userAgent) && (
                    <Badge variant="outline">{device(e.userAgent)}</Badge>
                  )}
                  {e.appVersion && (
                    <Badge variant={stale ? "default" : "outline"}>
                      v{e.appVersion}
                      {stale && ` → server v${serverVersion}`}
                    </Badge>
                  )}
                  <span className="text-muted-foreground">{timeAgo(e.createdAt)}</span>
                </div>
                {stale && (
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                    Crashed on an old bundle — the app was open across a deploy.
                    Usually fixed by closing and reopening it, not by a code change.
                  </p>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  isOpen && "rotate-180"
                )}
              />
            </button>

            {isOpen && (
              <div className="border-t border-black/5 bg-background/60 px-4 py-3 dark:border-white/5">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Source</dt>
                  <dd className="font-mono">{e.source ?? "—"}</dd>
                  <dt className="text-muted-foreground">User</dt>
                  <dd className="font-mono">{e.autheliaUser ?? "—"}</dd>
                  <dt className="text-muted-foreground">Digest</dt>
                  <dd className="font-mono">{e.digest ?? "—"}</dd>
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="font-mono">
                    {new Date(e.createdAt).toLocaleString("en-GB")}
                  </dd>
                </dl>
                {e.stack && (
                  <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">
                    {e.stack}
                  </pre>
                )}
                {e.userAgent && (
                  <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
                    {e.userAgent}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
