"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@dishes/ui";
import { Button, Textarea } from "@dishes/ui";
import { Camera, Loader2, MessageSquarePlus, Sparkles, X } from "lucide-react";
import { StarRating } from "./star-rating";
import { logCook, updateCookEntry, uploadCookPhoto } from "@/app/actions/cook-history";
import { reviewDishPhoto } from "@/app/actions/ai";
import { useRouter } from "next/navigation";

const OCCASION_SUGGESTIONS = [
  "Weeknight dinner",
  "Date night",
  "Family dinner",
  "Birthday",
  "Anniversary",
  "Dinner party",
  "Meal prep",
];

interface Props {
  recipeId: string;
  recipeTitle: string;
  pendingCookId: string | null;
  storageAvailable: boolean;
}

export function AddCookReviewSheet({
  recipeId,
  recipeTitle,
  pendingCookId,
  storageAvailable,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [occasion, setOccasion] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-open when landing from "Review later"
  useEffect(() => {
    if (pendingCookId) setOpen(true);
  }, [pendingCookId]);

  function handlePhotoChange(file: File | null) {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoFile(file);
    setPhotoPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setRating(null);
      setNotes("");
      setOccasion("");
      handlePhotoChange(null);
      setAiReview(null);
      setError(null);
      // Clear the URL param if present
      if (pendingCookId) {
        router.replace(`/recipes/${recipeId}`, { scroll: false });
      }
    }
    setOpen(next);
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        let cookId = pendingCookId;

        if (cookId) {
          await updateCookEntry(cookId, {
            rating: rating ?? null,
            notes: notes.trim() || null,
            occasion: occasion.trim() || null,
          });
        } else {
          const result = await logCook(recipeId, {
            rating: rating ?? null,
            notes: notes.trim() || null,
            occasion: occasion.trim() || null,
          });
          cookId = result.id;
        }

        let hasFeedback = false;
        if (photoFile && storageAvailable && cookId) {
          const fd = new FormData();
          fd.append("photo", photoFile);
          const { url } = await uploadCookPhoto(cookId, fd);
          if (url) {
            const { feedback } = await reviewDishPhoto(recipeTitle, url);
            if (feedback) {
              setAiReview(feedback);
              hasFeedback = true;
            }
          }
        }

        if (!hasFeedback) {
          setOpen(false);
          if (pendingCookId) router.replace(`/recipes/${recipeId}`, { scroll: false });
          router.refresh();
        }
      } catch {
        setError("Couldn't save your review — please try again.");
      }
    });
  }

  const isUpdating = !!pendingCookId;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Add a cook review"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {isUpdating ? "Add your review" : "Log a cook"}
        </button>
      </SheetTrigger>

      <SheetContent className="px-4 pb-8 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-sm sm:rounded-2xl overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>{isUpdating ? "How did it turn out?" : "Log a cook"}</SheetTitle>
          <p className="text-sm text-muted-foreground line-clamp-1">{recipeTitle}</p>
        </SheetHeader>

        {aiReview ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40 p-4 space-y-2">
              <div className="flex items-center gap-2 text-violet-700 dark:text-violet-400">
                <Sparkles className="h-4 w-4 shrink-0" />
                <span className="text-sm font-semibold">AI feedback</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{aiReview}</p>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                setOpen(false);
                if (pendingCookId) router.replace(`/recipes/${recipeId}`, { scroll: false });
                router.refresh();
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Rating */}
            <div className="flex flex-col items-center gap-3">
              <StarRating value={rating} onChange={setRating} size="lg" />
              <p className="text-sm text-muted-foreground h-5">
                {rating != null ? `${rating / 2} / 5` : "Tap to rate (optional)"}
              </p>
            </div>

            {/* Occasion */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Occasion (optional)</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {OCCASION_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setOccasion(occasion === s ? "" : s)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      occasion === s
                        ? "bg-primary text-primary-foreground border-primary"
                        : "hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Or write your own…"
                value={occasion}
                onChange={(e) => setOccasion(e.target.value)}
                className="w-full rounded-lg border bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea
                placeholder="What worked well, what you'd change, substitutions you made…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>

            {/* Photo */}
            {storageAvailable && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Photo (optional)</label>
                {photoPreviewUrl ? (
                  <div className="relative rounded-lg overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoPreviewUrl}
                      alt="Dish preview"
                      className="w-full aspect-video object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handlePhotoChange(null)}
                      className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                      aria-label="Remove photo"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 px-4 py-6 text-sm text-muted-foreground hover:bg-muted hover:border-muted-foreground/50 transition-colors">
                    <Camera className="h-5 w-5" />
                    Take or upload a photo of your dish
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => handlePhotoChange(e.target.files?.[0] ?? null)}
                    />
                  </label>
                )}
                {photoFile && (
                  <p className="text-xs text-muted-foreground">AI will review your presentation ✨</p>
                )}
              </div>
            )}

            {error && <p className="text-sm text-destructive text-center">{error}</p>}

            <Button className="w-full" onClick={handleSubmit} disabled={isPending}>
              {isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              ) : (
                "Save review"
              )}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
