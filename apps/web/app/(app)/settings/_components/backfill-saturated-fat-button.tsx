"use client";

import { useState } from "react";
import { Button } from "@dishes/ui";
import { HeartPulse, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { backfillSaturatedFat } from "@/app/actions/ai";

export function BackfillSaturatedFatButton() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<{ total: number; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setState("running");
    setResult(null);
    setError(null);
    const res = await backfillSaturatedFat();
    if (res.error) {
      setError(res.error);
      setState("error");
      return;
    }
    setResult({ total: res.total ?? 0, updated: res.updated ?? 0 });
    setState("done");
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-medium text-sm">Estimate saturated fat</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Use AI to add saturated fat to recipes that don&rsquo;t have it yet, so the
          heart-healthy filter can judge them. One AI call per recipe.
          {result && (
            <span className="ml-1 text-green-600 dark:text-green-400">
              Done — {result.updated} of {result.total} updated.
            </span>
          )}
          {error && <span className="ml-1 text-destructive">{error}</span>}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleClick()}
        disabled={state === "running"}
        className="shrink-0"
      >
        {state === "running" ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : state === "done" ? (
          <CheckCircle2 className="mr-1.5 h-4 w-4 text-green-600" />
        ) : state === "error" ? (
          <AlertCircle className="mr-1.5 h-4 w-4 text-destructive" />
        ) : (
          <HeartPulse className="mr-1.5 h-4 w-4" />
        )}
        {state === "running" ? "Running…" : state === "done" ? "Done" : "Run"}
      </Button>
    </div>
  );
}
