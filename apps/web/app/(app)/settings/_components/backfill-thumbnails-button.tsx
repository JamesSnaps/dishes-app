"use client";

import { useState } from "react";
import { Button } from "@dishes/ui";
import { ImagePlus, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Result = { total: number; succeeded: number; failed: number };

export function BackfillThumbnailsButton() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setState("running");
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/backfill-thumbnails", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data as Result);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-medium text-sm">Backfill image thumbnails</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Generate 400px thumbnails for recipes that don&apos;t have one yet.
          {result && (
            <span className="ml-1 text-green-600 dark:text-green-400">
              Done — {result.succeeded} updated
              {result.failed > 0 ? `, ${result.failed} failed` : ""}.
            </span>
          )}
          {error && (
            <span className="ml-1 text-destructive">{error}</span>
          )}
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
          <ImagePlus className="mr-1.5 h-4 w-4" />
        )}
        {state === "running" ? "Running…" : state === "done" ? "Done" : "Run"}
      </Button>
    </div>
  );
}
