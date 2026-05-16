"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { Button, Textarea } from "@dishes/ui";
import { StarRating } from "@/app/(app)/recipes/[id]/_components/star-rating";
import { logCook, uploadCookPhoto } from "@/app/actions/cook-history";
import { reviewDishPhoto } from "@/app/actions/ai";
import { updateRecipeCookTime } from "@/app/actions/recipes";
import { deductRecipeIngredients } from "@/app/actions/pantry";

const OCCASION_SUGGESTIONS = [
  "Weeknight dinner",
  "Date night",
  "Family dinner",
  "Birthday",
  "Anniversary",
  "Dinner party",
  "Meal prep",
];

type HouseholdMember = { id: string; displayName: string };
type Phase = "form" | "reviewed";

interface Props {
  recipeId: string;
  recipeTitle: string;
  recipeServings: number | null;
  storedCookTimeMinutes: number | null;
  elapsedMinutes: number;
  currentServings: number;
  householdMembers?: HouseholdMember[];
  storageAvailable?: boolean;
}

export function CookDebrief({
  recipeId,
  recipeTitle,
  recipeServings: _recipeServings,
  storedCookTimeMinutes,
  elapsedMinutes,
  currentServings,
  householdMembers = [],
  storageAvailable = false,
}: Props) {
  const router = useRouter();

  // Form state
  const [rating, setRating] = useState<number | null>(null);
  const [duration, setDuration] = useState(elapsedMinutes);
  const [notes, setNotes] = useState("");
  const [occasion, setOccasion] = useState("");
  const [cookedForIds, setCookedForIds] = useState<Set<string>>(new Set());
  const [deducted, setDeducted] = useState(false);
  const [deducting, setDeducting] = useState(false);

  // Photo state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  // Post-submit review state
  const [phase, setPhase] = useState<Phase>("form");
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<string | null>(null);

  const cookTimeDiffers =
    !storedCookTimeMinutes || Math.abs(storedCookTimeMinutes - duration) >= 5;

  function adjustDuration(delta: number) {
    setDuration((d) => Math.max(1, d + delta));
  }

  function toggleMember(id: string) {
    setCookedForIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handlePhotoChange(file: File | null) {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoFile(file);
    setPhotoPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  function handleSkip() {
    router.push(`/recipes/${recipeId}`);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setLoadingMessage("Saving…");

    try {
      const cookedForNames = householdMembers
        .filter((m) => cookedForIds.has(m.id))
        .map((m) => m.displayName);

      const { id: cookId } = await logCook(recipeId, {
        rating: rating ?? null,
        actualDuration: duration,
        notes: notes.trim() || null,
        occasion: occasion.trim() || null,
        cookedFor: cookedForNames.length ? cookedForNames : null,
      });

      if (cookTimeDiffers) {
        updateRecipeCookTime(recipeId, duration).catch(() => {});
      }

      if (photoFile && storageAvailable) {
        setLoadingMessage("Uploading photo…");
        const fd = new FormData();
        fd.append("photo", photoFile);
        const { url } = await uploadCookPhoto(cookId, fd);

        if (url) {
          setUploadedPhotoUrl(url);
          setLoadingMessage("Getting AI feedback…");
          const { feedback } = await reviewDishPhoto(recipeTitle, url);
          if (feedback) {
            setAiReview(feedback);
            setPhase("reviewed");
            setSubmitting(false);
            return;
          }
        }
      }

      router.push(`/recipes/${recipeId}`);
    } catch {
      setSubmitting(false);
      setLoadingMessage("");
    }
  }

  async function handleDeduct() {
    setDeducting(true);
    try {
      await deductRecipeIngredients(recipeId, currentServings);
      setDeducted(true);
    } finally {
      setDeducting(false);
    }
  }

  // ── Reviewed phase ────────────────────────────────────────────────────────

  if (phase === "reviewed") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-y-auto">
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          {/* Photo */}
          {uploadedPhotoUrl && (
            <div className="w-full aspect-video overflow-hidden bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={uploadedPhotoUrl}
                alt="Your dish"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div className="px-5 py-8 space-y-6 flex-1">
            {/* AI review card */}
            {aiReview && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-violet-700 dark:text-violet-400">
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-semibold">AI feedback</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{aiReview}</p>
              </div>
            )}

            <p className="text-center text-sm text-muted-foreground">
              Your cook has been saved.
            </p>

            <Button className="w-full" onClick={() => router.push(`/recipes/${recipeId}`)}>
              Continue to recipe →
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form phase ────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col items-center pt-12 pb-8 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15 mb-4">
          <CheckCircle2 className="h-9 w-9 text-green-500" />
        </div>
        <h1 className="text-2xl font-bold">All done!</h1>
        <p className="mt-1 text-muted-foreground text-sm line-clamp-1 max-w-xs">
          {recipeTitle}
        </p>
      </div>

      {/* Form */}
      <div className="flex-1 px-5 pb-8 max-w-md mx-auto w-full space-y-8">

        {/* Duration */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-muted-foreground" />
            How long did it take?
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => adjustDuration(-5)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border hover:bg-muted transition-colors"
              aria-label="Decrease by 5 minutes"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[5rem] text-center text-lg font-semibold tabular-nums">
              {duration < 60
                ? `${duration} min`
                : `${Math.floor(duration / 60)}h ${duration % 60 > 0 ? `${duration % 60}m` : ""}`}
            </span>
            <button
              type="button"
              onClick={() => adjustDuration(5)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border hover:bg-muted transition-colors"
              aria-label="Increase by 5 minutes"
            >
              <Plus className="h-4 w-4" />
            </button>
            {storedCookTimeMinutes && cookTimeDiffers && (
              <span className="text-xs text-muted-foreground">
                Recipe says {storedCookTimeMinutes} min — we&apos;ll update it
              </span>
            )}
          </div>
        </div>

        {/* Rating */}
        <div className="space-y-3">
          <label className="text-sm font-medium">How did it go?</label>
          <div className="flex flex-col items-start gap-2">
            <StarRating value={rating} onChange={setRating} size="lg" />
            <p className="text-sm text-muted-foreground h-4">
              {rating != null ? `${rating / 2} / 5` : "Tap to rate (optional)"}
            </p>
          </div>
        </div>

        {/* Who did you cook for? */}
        {householdMembers.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Who did you cook for?</label>
            <div className="flex flex-wrap gap-2">
              {householdMembers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMember(m.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    cookedForIds.has(m.id)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {m.displayName}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Occasion */}
        <div className="space-y-2">
          <label className="text-sm font-medium">What was the occasion?</label>
          <div className="flex flex-wrap gap-2 mb-2">
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
          <label className="text-sm font-medium">Any notes?</label>
          <Textarea
            placeholder="What worked well, what you'd change, substitutions you made…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>

        {/* Dish photo */}
        {storageAvailable && (
          <div className="space-y-2">
            <label className="text-sm font-medium">How did it look?</label>
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
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => handlePhotoChange(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
            {photoFile && (
              <p className="text-xs text-muted-foreground">
                AI will review your presentation after saving ✨
              </p>
            )}
          </div>
        )}

        {/* Pantry deduction */}
        {!deducted ? (
          <button
            type="button"
            onClick={handleDeduct}
            disabled={deducting}
            className="flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            <PackageCheck className="h-4 w-4" />
            {deducting ? "Updating pantry…" : "Mark ingredients as used from pantry"}
          </button>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Pantry stock updated.
          </p>
        )}

        {/* Actions */}
        <div className="space-y-2 pt-2">
          <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{loadingMessage}</>
            ) : (
              "Save & finish"
            )}
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={handleSkip}
            disabled={submitting}
          >
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
}
