"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@dishes/ui";
import { addPendingImageJob } from "@/components/providers/jobs-provider";

interface Props {
  recipeId: string;
  recipeTitle: string;
}

export function GenerateImageButton({ recipeId, recipeTitle }: Props) {
  const [state, setState] = useState<"idle" | "starting" | "queued">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setState("starting");
    setError(null);
    try {
      const res = await fetch(`/api/recipes/${recipeId}/generate-image`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to start image generation");
      }
      const { jobId } = await res.json();
      addPendingImageJob({ jobId, recipeId, recipeTitle });
      setState("queued");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("idle");
    }
  }

  if (state === "queued") {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        <span>
          Generating image &mdash; you can navigate away and we&apos;ll notify you when
          it&apos;s ready.
        </span>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleClick()}
        disabled={state === "starting"}
        className="gap-2"
      >
        {state === "starting" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {state === "starting" ? "Starting…" : "Generate image with AI"}
      </Button>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
