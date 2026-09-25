"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PackageCheck, Sparkles } from "lucide-react";
import { Button } from "@dishes/ui";
import { logCook } from "@/app/actions/cook-history";
import { updateRecipeCookTime } from "@/app/actions/recipes";
import { deductRecipeIngredients } from "@/app/actions/pantry";
import { CookReviewFields, saveCookReview, useCookReview } from "@/components/cook-review/cook-review-form";

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
  ownName?: string | null;
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
  ownName = null,
  storageAvailable = false,
}: Props) {
  const router = useRouter();

  const { state: review, update } = useCookReview({ duration: elapsedMinutes });
  const duration = review.duration ?? elapsedMinutes;
  const [deducted, setDeducted] = useState(false);
  const [deducting, setDeducting] = useState(false);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Post-submit review state
  const [phase, setPhase] = useState<Phase>("form");
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<string | null>(null);

  const cookTimeDiffers =
    !storedCookTimeMinutes || Math.abs(storedCookTimeMinutes - duration) >= 5;

  async function handleReviewLater() {
    try {
      await logCook(recipeId, {
        actualDuration: duration,
        occasion: review.occasion.trim() || null,
        cookedFor: review.cookedFor.length ? review.cookedFor : null,
      });
      if (cookTimeDiffers) {
        updateRecipeCookTime(recipeId, duration).catch(() => {});
      }
      // The cook is logged; "Review later" means defer the rating, so go
      // straight back to the recipe without re-triggering the review sheet.
      router.push(`/recipes/${recipeId}`);
    } catch {
      router.push(`/recipes/${recipeId}`);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    setLoadingMessage("Saving…");

    try {
      if (review.photoFile && storageAvailable) setLoadingMessage("Saving and uploading photo…");
      const { photoUrl, feedback } = await saveCookReview({ recipeId }, review, { recipeTitle, storageAvailable, ownName });
      if (cookTimeDiffers) updateRecipeCookTime(recipeId, duration).catch(() => {});
      if (feedback) {
        setUploadedPhotoUrl(photoUrl);
        setAiReview(feedback);
        setPhase("reviewed");
        setSubmitting(false);
        return;
      }
    } catch {
      setSubmitting(false);
      setLoadingMessage("");
      setSubmitError("Couldn't save your cook — please try again.");
      return;
    }

    router.push(`/recipes/${recipeId}`);
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

        <CookReviewFields
          state={review}
          update={update}
          members={householdMembers}
          ownName={ownName}
          storageAvailable={storageAvailable}
          durationHint={
            storedCookTimeMinutes && cookTimeDiffers
              ? `Recipe says ${storedCookTimeMinutes} min — we'll update it`
              : null
          }
        />

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
          {submitError && (
            <p className="text-center text-sm text-destructive">{submitError}</p>
          )}
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
            onClick={handleReviewLater}
            disabled={submitting}
          >
            Review later
          </Button>
        </div>
      </div>
    </div>
  );
}
