"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { CookReviewSheet } from "@/components/cook-review/cook-review-sheet";
import type { ReviewMember } from "@/components/cook-review/cook-review-form";
import type { CookHistoryEntry } from "@/lib/services/cook-history";

interface Props {
  recipeId: string;
  recipeTitle: string;
  /** Set when landing from cooking mode's "Review later". */
  pendingCookId: string | null;
  pendingEntry: CookHistoryEntry | null;
  members: ReviewMember[];
  ownName: string | null;
  storageAvailable: boolean;
}

export function AddCookReviewSheet({
  recipeId,
  recipeTitle,
  pendingCookId,
  pendingEntry,
  members,
  ownName,
  storageAvailable,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Auto-open when landing from "Review later"
  useEffect(() => {
    if (pendingCookId) setOpen(true);
  }, [pendingCookId]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && pendingCookId) router.replace(`/recipes/${recipeId}`, { scroll: false });
  }

  const isUpdating = !!pendingCookId;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Add a cook review"
      >
        <MessageSquarePlus className="h-4 w-4" />
        {isUpdating ? "Add your review" : "Log a cook"}
      </button>
      <CookReviewSheet
        open={open}
        onOpenChange={handleOpenChange}
        title={isUpdating ? "How did it turn out?" : "Log a cook"}
        recipeTitle={recipeTitle}
        target={pendingCookId ? { cookId: pendingCookId } : { recipeId }}
        initial={
          pendingEntry
            ? {
                duration: pendingEntry.actualDuration,
                rating: pendingEntry.rating,
                cookedFor: pendingEntry.cookedFor,
                memberRatings: pendingEntry.memberRatings,
                occasion: pendingEntry.occasion,
                notes: pendingEntry.notes,
                photoUrl: pendingEntry.photoUrl,
              }
            : undefined
        }
        members={members}
        ownName={ownName}
        storageAvailable={storageAvailable}
      />
    </>
  );
}
