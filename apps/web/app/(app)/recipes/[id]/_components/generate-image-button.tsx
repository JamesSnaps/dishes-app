"use client";

import { useState } from "react";
import { Sparkles, Loader2, SlidersHorizontal } from "lucide-react";
import { Button, Textarea } from "@dishes/ui";
import { addPendingImageJob } from "@/components/providers/jobs-provider";
import { toast } from "@/hooks/use-toast";
import { IMAGE_STYLES } from "@/lib/image-styles";
import type { ImageStyleValue } from "@/lib/image-styles";

interface Props {
  recipeId: string;
  recipeTitle: string;
  defaultStyle?: ImageStyleValue;
}

export function GenerateImageButton({ recipeId, recipeTitle, defaultStyle = "studio" }: Props) {
  const [state, setState] = useState<"idle" | "starting" | "queued">("idle");
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<ImageStyleValue>(defaultStyle);
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState("");

  async function handleClick() {
    setState("starting");
    setError(null);
    try {
      const res = await fetch(`/api/recipes/${recipeId}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style,
          instructions: instructions.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to start image generation");
      }
      const { jobId } = await res.json();
      addPendingImageJob({ jobId, recipeId, recipeTitle });
      toast({
        title: "Generating image",
        description: "You can navigate away — we'll notify you when it's ready.",
      });
      window.dispatchEvent(new Event("dishes-notification-added"));
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
    <div className="mb-6 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value as ImageStyleValue)}
          disabled={state === "starting"}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          aria-label="Image style"
        >
          {IMAGE_STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

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

        <button
          type="button"
          onClick={() => setShowInstructions((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={showInstructions}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {showInstructions ? "Hide instructions" : "Custom instructions"}
        </button>
      </div>

      {showInstructions && (
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={state === "starting"}
          maxLength={500}
          rows={2}
          placeholder='Added to the style prompt — e.g. "show a single slice on a plate with a fork, not the whole cake"'
          className="max-w-lg text-sm"
        />
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
