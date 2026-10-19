"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, X, AlertCircle, ChefHat, CalendarDays } from "lucide-react";
import { Button, cn } from "@dishes/ui";
import {
  AI_JOBS_CHANGED,
  fetchAiJob,
  isAiJobClaimed,
  listTrackedAiJobs,
  untrackAiJob,
  type AiJobView,
  type TrackedAiJob,
} from "@/lib/ai-jobs-client";
import type { BatchJobProgress, RecipeJobResult } from "@/lib/ai/job-types";
import { recipeJobToDefaults, stashAiDraft } from "@/lib/ai/recipe-defaults";

const POLL_MS = 2500;

// AI generations whose page has gone away. The page that started a job waits
// on it itself ("claims" it); once that page unmounts the job shows up here,
// keeps polling, and offers the result from wherever you are in the app.
export function AiJobsTray() {
  const router = useRouter();
  const [tracked, setTracked] = useState<TrackedAiJob[]>([]);
  const [views, setViews] = useState<Record<string, AiJobView>>({});
  const viewsRef = useRef(views);
  useEffect(() => {
    viewsRef.current = views;
  }, [views]);

  // Only jobs no mounted page is waiting on.
  const refresh = useCallback(() => {
    setTracked(listTrackedAiJobs().filter((j) => !isAiJobClaimed(j.jobId)));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(AI_JOBS_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(AI_JOBS_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (tracked.length === 0) return;

    let cancelled = false;
    const poll = async () => {
      const open = tracked.filter((j) => {
        const v = viewsRef.current[j.jobId];
        return !v || v.status === "running";
      });
      if (open.length === 0) return;
      const results = await Promise.all(open.map(async (j) => [j.jobId, await fetchAiJob(j.jobId)] as const));
      if (cancelled) return;
      for (const [id, v] of results) if (v === "missing") untrackAiJob(id);
      setViews((prev) => {
        const next = { ...prev };
        for (const [id, v] of results) if (v && v !== "missing") next[id] = v;
        return next;
      });
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tracked]);

  if (tracked.length === 0) return null;

  function openRecipe(job: TrackedAiJob, view: AiJobView) {
    stashAiDraft(recipeJobToDefaults(view.result as RecipeJobResult));
    untrackAiJob(job.jobId);
    router.push("/recipes/new");
  }

  function openBatch(job: TrackedAiJob, view: AiJobView) {
    const saved = (view.result as BatchJobProgress | undefined)?.items.filter((i) => i.recipeId) ?? [];
    untrackAiJob(job.jobId);
    router.push(saved.length === 1 ? `/recipes/${saved[0]!.recipeId}` : "/recipes");
  }

  function openIdeas(job: TrackedAiJob) {
    // The page resumes the job on mount and untracks it once it has the ideas.
    router.push(job.href ?? "/ai-concierge");
  }

  function openPlan(job: TrackedAiJob) {
    // Same as ideas: the plan tab restores its form and the draft on mount.
    router.push(job.href ?? "/ai-concierge?tab=plan");
  }

  return (
    <div className="fixed inset-x-4 z-40 bottom-[calc(4rem+env(safe-area-inset-bottom,0px)+0.75rem)] flex flex-col items-end gap-2 pointer-events-none lg:inset-x-auto lg:right-6 lg:bottom-6 print:hidden">
      {tracked.map((job) => {
        const view = views[job.jobId];
        const status = view?.status ?? "running";
        const batch = view?.progress as BatchJobProgress | undefined;
        const batchDone = batch?.items.filter((i) => i.status === "done").length ?? 0;
        const batchTotal = batch?.items.length;

        let title: string;
        let detail: string;
        let action: { label: string; onClick: () => void } | null = null;

        if (status === "failed") {
          title =
            job.kind === "concepts"
              ? "Couldn't come up with ideas"
              : job.kind === "meal-plan"
                ? "Couldn't plan your week"
                : `Couldn't finish “${job.label}”`;
          detail = view?.error ?? "Something went wrong.";
        } else if (status === "running") {
          title =
            job.kind === "recipe"
              ? `Writing “${job.label}”…`
              : job.kind === "recipe-batch"
                ? "Writing your recipes…"
                : job.kind === "meal-plan"
                  ? "Planning your week…"
                  : "Thinking of ideas…";
          detail =
            job.kind === "recipe-batch" && batchTotal
              ? `${batchDone} of ${batchTotal} saved — keep browsing, they'll be added to your recipes.`
              : "Keep browsing — this will be here when it's ready.";
        } else if (job.kind === "recipe") {
          title = "Recipe ready";
          detail = `“${(view?.result as RecipeJobResult | undefined)?.recipe.title ?? job.label}” is ready to review and save.`;
          action = { label: "Open", onClick: () => openRecipe(job, view!) };
        } else if (job.kind === "recipe-batch") {
          const items = (view?.result as BatchJobProgress | undefined)?.items ?? [];
          const ok = items.filter((i) => i.status === "done").length;
          const failed = items.length - ok;
          title = ok === 1 ? "1 recipe added" : `${ok} recipes added`;
          detail = failed > 0 ? `${failed} couldn't be written — try those again from the concierge.` : "Saved to your recipes.";
          action = ok > 0 ? { label: "View", onClick: () => openBatch(job, view!) } : null;
        } else if (job.kind === "meal-plan") {
          title = "Draft plan ready";
          detail = "Look over the meals, then add them to your planner.";
          action = { label: "View plan", onClick: () => openPlan(job) };
        } else {
          title = "Recipe ideas ready";
          detail = "Pick the ones you'd like written up.";
          action = { label: "View ideas", onClick: () => openIdeas(job) };
        }

        return (
          <div
            key={job.jobId}
            role="status"
            className={cn(
              "pointer-events-auto w-full max-w-sm rounded-2xl border p-3 shadow-xl backdrop-blur",
              status === "failed"
                ? "border-destructive/30 bg-gradient-to-br from-red-50/95 to-orange-50/95 dark:from-red-950/90 dark:to-orange-950/80"
                : "border-violet-200 bg-gradient-to-br from-violet-50/95 to-orange-50/95 dark:border-violet-800 dark:from-violet-950/90 dark:to-orange-950/80"
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  status === "failed"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-violet-600/15 text-violet-700 dark:text-violet-300"
                )}
              >
                {status === "running" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : status === "failed" ? (
                  <AlertCircle className="h-4 w-4" />
                ) : job.kind === "concepts" ? (
                  <Sparkles className="h-4 w-4" />
                ) : job.kind === "meal-plan" ? (
                  <CalendarDays className="h-4 w-4" />
                ) : (
                  <ChefHat className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">{title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
                {action && (
                  <Button
                    size="sm"
                    onClick={action.onClick}
                    className="mt-2 h-8 bg-gradient-to-r from-violet-600 to-orange-500 text-white shadow-sm hover:from-violet-700 hover:to-orange-600"
                  >
                    {action.label}
                  </Button>
                )}
              </div>
              <button
                type="button"
                onClick={() => untrackAiJob(job.jobId)}
                className="-mr-1 -mt-1 rounded-lg p-1.5 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                aria-label={status === "running" ? "Hide" : "Dismiss"}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
