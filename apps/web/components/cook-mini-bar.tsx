"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChefHat, ChevronUp, Timer, X } from "lucide-react";
import { Button } from "@dishes/ui";
import {
  formatTimer,
  mostUrgentTimer,
  useCookSession,
} from "@/components/providers/cook-session-provider";

// The minimised face of cooking mode: a persistent bar that keeps a cook alive
// while you use the rest of the app, and carries timer alerts with it.

export function CookMiniBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, sessions, hydrated, timers, alerts, endSession, setStepIndex, dismissAlert } =
    useCookSession();

  // Cooking mode has its own controls; the print view should stay clean.
  const suppressed = pathname?.endsWith("/cook") || pathname?.endsWith("/print") || false;
  const visible = hydrated && !!session && !suppressed;

  // The cook currently open full-screen, if any — it renders its own alerts.
  const openCookRecipeId = pathname?.match(/^\/recipes\/([^/]+)\/cook$/)?.[1] ?? null;
  // Alerts still need to reach you when a *different* cook is on screen, so
  // they are not suppressed with the bar — only the ones already handled are.
  const visibleAlerts = hydrated
    ? alerts.filter((a) => a.recipeId !== openCookRecipeId)
    : [];

  // Lets the app layout add bottom padding so the bar never covers content.
  useEffect(() => {
    if (visible) document.body.setAttribute("data-cook-session", "");
    else document.body.removeAttribute("data-cook-session");
    return () => document.body.removeAttribute("data-cook-session");
  }, [visible]);

  if (!hydrated) return null;

  const urgent = session ? mostUrgentTimer(timers) : null;
  const otherCount = sessions.length - 1;

  function resume(recipeId: string, stepIndex?: number) {
    if (stepIndex !== undefined) setStepIndex(stepIndex, recipeId);
    router.push(`/recipes/${recipeId}/cook`);
  }

  return (
    <>
      {/* ── Timer finished alerts ─────────────────────────────────────── */}
      {visibleAlerts.length > 0 && (
        <div className="fixed inset-x-0 bottom-36 lg:bottom-28 z-[60] flex flex-col items-center gap-2.5 px-4 pointer-events-none">
          {visibleAlerts.map(({ recipeId, recipeTitle, stepIndex, timer }) => (
            <div
              key={`${recipeId}:${stepIndex}`}
              className="pointer-events-auto w-full max-w-md rounded-2xl border border-green-500/40 bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-950 dark:to-emerald-900 p-4 shadow-2xl"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-500 text-white animate-pulse">
                  <Timer className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  {/* Name the dish whenever more than one cook is live — "step 4"
                      alone is ambiguous with dinner and dessert both going. */}
                  {sessions.length > 1 && (
                    <p className="truncate text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">
                      {recipeTitle}
                    </p>
                  )}
                  <p className="font-semibold text-sm">
                    Timer finished — Step {timer.stepNumber}
                    {timer.label ? ` · ${timer.label}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {timer.preview}
                  </p>
                </div>
                <button
                  onClick={() => dismissAlert(stepIndex, recipeId)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  aria-label="Dismiss timer alert"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => {
                    dismissAlert(stepIndex, recipeId);
                    resume(recipeId, stepIndex);
                  }}
                >
                  Back to step {timer.stepNumber}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => dismissAlert(stepIndex, recipeId)}
                >
                  OK
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!visible || !session ? null : (
      <>
      {/* ── Mini bar ──────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-50 px-3 pb-2 print:hidden lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-[360px] lg:px-0 lg:pb-0">
        {/* Solid background colour under the gradient — nothing behind this bar
            should ever show through it, and it must sit above both navs. */}
        <div className="flex items-center gap-2 rounded-2xl bg-orange-600 bg-gradient-to-br from-orange-500 to-amber-600 p-2 pl-3 text-white shadow-2xl shadow-black/30 ring-1 ring-black/10">
          <button
            onClick={() => resume(session!.recipeId)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-label={`Resume cooking ${session.recipeTitle}`}
          >
            {session.recipeImageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={session.recipeImageUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-white/30"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
                <ChefHat className="h-5 w-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-tight">
                {session.recipeTitle}
              </span>
              <span className="flex items-center gap-2 text-xs leading-tight text-white/95">
                <span>
                  Step {session.stepIndex + 1} of {session.stepCount}
                </span>
                {urgent && (
                  <span className="flex items-center gap-1 font-mono font-semibold tabular-nums">
                    <Timer className="h-3 w-3" />
                    {urgent[1].done ? "Done!" : formatTimer(urgent[1].remaining)}
                  </span>
                )}
                {otherCount > 0 && (
                  <span className="rounded-full bg-white/25 px-1.5 py-px font-medium">
                    +{otherCount} more
                  </span>
                )}
              </span>
            </span>
            <ChevronUp className="h-5 w-5 shrink-0 opacity-80" />
          </button>

          <button
            onClick={() => {
              if (confirm(`End the cook for "${session!.recipeTitle}"? Timers will be cleared.`))
                endSession(session!.recipeId);
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20"
            aria-label="End cooking session"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      </>
      )}
    </>
  );
}
