"use client";

import { useRouter } from "next/navigation";
import { ChefHat, Timer, Layers, Check } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dishes/ui";
import {
  formatTimer,
  mostUrgentTimer,
  useCookSession,
} from "@/components/providers/cook-session-provider";

// Fast switch between cooks in progress. Dinner and dessert at the same time
// used to mean minimise → navigate → resume for every swap; this jumps straight
// across, keeping both sessions and their timers running.
export function CookSwitcher({ currentRecipeId }: { currentRecipeId: string }) {
  const router = useRouter();
  const { sessions, timersFor, activateSession } = useCookSession();

  // Nothing to switch between — stay out of the way.
  if (sessions.length < 2) return null;

  function switchTo(recipeId: string) {
    if (recipeId === currentRecipeId) return;
    activateSession(recipeId);
    router.push(`/recipes/${recipeId}/cook`);
  }

  const otherCount = sessions.filter((s) => s.recipeId !== currentRecipeId).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 border-orange-500/40 bg-orange-500/10 text-orange-700 hover:bg-orange-500/20 dark:text-orange-300"
          title="Switch between cooks in progress"
        >
          <Layers className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">
            {sessions.length} cooks
          </span>
          <span className="sm:hidden">{otherCount + 1}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Cooking now
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sessions.map((s) => {
          const isCurrent = s.recipeId === currentRecipeId;
          const urgent = mostUrgentTimer(timersFor(s.recipeId));
          const alertCount = s.finishedAlerts.length;
          return (
            <DropdownMenuItem
              key={s.recipeId}
              onSelect={() => switchTo(s.recipeId)}
              className="flex items-center gap-2.5 py-2.5"
            >
              {s.recipeImageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={s.recipeImageUrl}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <ChefHat className="h-4 w-4 text-muted-foreground" />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium leading-none">
                  {s.recipeTitle}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Step {s.stepIndex + 1} of {s.stepCount}
                  </span>
                  {urgent && (
                    <span
                      className={`flex items-center gap-1 font-mono tabular-nums ${
                        urgent[1].done ? "font-semibold text-green-600 dark:text-green-400" : ""
                      }`}
                    >
                      <Timer className="h-3 w-3" />
                      {urgent[1].done ? "Done!" : formatTimer(urgent[1].remaining)}
                    </span>
                  )}
                </span>
              </span>
              {alertCount > 0 && !urgent?.[1].done && (
                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-green-600 px-1.5 text-[11px] font-semibold text-white">
                  {alertCount}
                </span>
              )}
              {isCurrent && <Check className="h-4 w-4 shrink-0 text-orange-500" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
