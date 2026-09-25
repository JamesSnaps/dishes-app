"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from "@dishes/ui";
import {
  CookReviewFields,
  saveCookReview,
  useCookReview,
  type CookReviewInitial,
  type ReviewMember,
} from "./cook-review-form";

/**
 * The full review form in a sheet — logs a new cook (`recipeId`) or edits an
 * existing one (`cookId`). After saving a new photo it shows the AI's
 * presentation feedback before closing.
 */
export function CookReviewSheet({
  open,
  onOpenChange,
  title,
  recipeTitle,
  target,
  initial,
  members,
  storageAvailable,
  ownName = null,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  recipeTitle: string;
  target: { cookId: string } | { recipeId: string };
  initial?: CookReviewInitial;
  members: ReviewMember[];
  storageAvailable: boolean;
  /** Display name of whoever is logged in — their rating is "your rating". */
  ownName?: string | null;
  /** Called once the sheet closes after a successful save. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const { state, update, reset } = useCookReview({ ...initial, ownName });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Start from the entry's current values each time the sheet opens.
  useEffect(() => {
    if (open) {
      reset({ ...initial, ownName });
      setError(null);
      setFeedback(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function finish() {
    onOpenChange(false);
    router.refresh();
    onDone?.();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await saveCookReview(target, state, { recipeTitle, storageAvailable, ownName });
      if (res.feedback) setFeedback(res.feedback);
      else finish();
    } catch (e) {
      setError((e as Error).message || "Couldn't save — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-h-[92dvh] overflow-y-auto px-4 pb-8 sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
        <SheetHeader className="mb-6">
          <SheetTitle>{title}</SheetTitle>
          <p className="line-clamp-1 text-sm text-muted-foreground">{recipeTitle}</p>
        </SheetHeader>

        {feedback ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4 shadow-sm dark:border-violet-800 dark:from-violet-950/40 dark:to-fuchsia-950/30">
              <div className="flex items-center gap-2 text-violet-700 dark:text-violet-400">
                <Sparkles className="h-4 w-4 shrink-0" />
                <span className="text-sm font-semibold">AI feedback</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{feedback}</p>
            </div>
            <Button className="w-full" onClick={finish}>
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <CookReviewFields state={state} update={update} members={members} storageAvailable={storageAvailable} ownName={ownName} />
            {error && <p className="text-center text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
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
