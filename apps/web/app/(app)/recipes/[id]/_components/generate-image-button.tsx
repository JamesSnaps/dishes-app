"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, SlidersHorizontal, ImagePlus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@dishes/ui";
import { addPendingImageJob, IMAGE_FAILED_EVENT, IMAGE_READY_EVENT, type ImageReadyDetail } from "@/components/providers/jobs-provider";
import { toast } from "@/hooks/use-toast";
import { IMAGE_STYLES } from "@/lib/image-styles";
import type { ImageStyleValue } from "@/lib/image-styles";

interface Props {
  recipeId: string;
  recipeTitle: string;
  defaultStyle?: ImageStyleValue;
}

// Style + instructions + Generate. Starts a background job, so you can leave
// the page; the jobs provider refreshes the recipe when the photo lands.
function GenerateImageForm({
  recipeId,
  recipeTitle,
  defaultStyle = "studio",
  onQueued,
  replacing = false,
}: Props & { onQueued: () => void; replacing?: boolean }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<ImageStyleValue>(defaultStyle);
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState("");

  async function handleClick() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/recipes/${recipeId}/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
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
      onQueued();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value as ImageStyleValue)}
          disabled={starting}
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
          size="sm"
          onClick={() => void handleClick()}
          disabled={starting}
          className="gap-2 bg-gradient-to-r from-violet-600 to-orange-500 text-white shadow-sm hover:from-violet-700 hover:to-orange-600"
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {starting ? "Starting…" : replacing ? "Generate new photo" : "Generate image with AI"}
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
          disabled={starting}
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

/** True from queuing until this recipe's photo arrives (or fails). */
function useImagePending(recipeId: string) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const onReady = (e: Event) => {
      if ((e as CustomEvent<ImageReadyDetail>).detail?.recipeId === recipeId) setPending(false);
    };
    window.addEventListener(IMAGE_READY_EVENT, onReady);
    window.addEventListener(IMAGE_FAILED_EVENT, onReady);
    return () => {
      window.removeEventListener(IMAGE_READY_EVENT, onReady);
      window.removeEventListener(IMAGE_FAILED_EVENT, onReady);
    };
  }, [pending, recipeId]);
  return [pending, () => setPending(true)] as const;
}

function GeneratingNotice() {
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

/** Shown in place of the hero image when a recipe has no photo yet. */
export function GenerateImageButton(props: Props) {
  const [pending, markPending] = useImagePending(props.recipeId);
  if (pending) return <GeneratingNotice />;
  return (
    <div className="mb-6">
      <GenerateImageForm {...props} onQueued={markPending} />
    </div>
  );
}

/** The same form in a dialog, for replacing a photo the recipe already has. */
export function GenerateImageDialog({
  open,
  onOpenChange,
  onQueued,
  ...props
}: Props & { open: boolean; onOpenChange: (open: boolean) => void; onQueued?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            New photo with AI
          </DialogTitle>
          <DialogDescription>
            Generates a fresh photo for &ldquo;{props.recipeTitle}&rdquo; and replaces the current one.
          </DialogDescription>
        </DialogHeader>
        <GenerateImageForm
          {...props}
          replacing
          onQueued={() => {
            onOpenChange(false);
            onQueued?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Overlay button on the hero image. */
export function RegenerateImageButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [pending, markPending] = useImagePending(props.recipeId);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur transition-colors hover:bg-black/75 disabled:cursor-default print:hidden"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
        {pending ? "Generating…" : "New photo"}
      </button>
      <GenerateImageDialog {...props} open={open} onOpenChange={setOpen} onQueued={markPending} />
    </>
  );
}
