"use client";

import { useState, useTransition } from "react";
import { Clock, Pencil, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@dishes/ui";
import { StarRating } from "./star-rating";
import { deleteCookEntry } from "@/app/actions/cook-history";
import { sameName } from "@/lib/cook-ratings";
import { CookReviewSheet } from "@/components/cook-review/cook-review-sheet";
import type { ReviewMember } from "@/components/cook-review/cook-review-form";
import type { CookHistoryEntry as Entry } from "@/lib/services/cook-history";

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return "Last week";
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fullDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// One logged cook: its own rating, notes, occasion and photo. Ratings live on
// the entry, so the recipe's headline rating is the average across these.
export function CookHistoryEntryCard({
  entry,
  recipeTitle,
  members,
  ownName,
  storageAvailable,
}: {
  entry: Entry;
  recipeTitle: string;
  members: ReviewMember[];
  ownName: string | null;
  storageAvailable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      await deleteCookEntry(entry.id);
      setConfirmDelete(false);
    });
  }

  return (
    <>
      <div className="rounded-lg border bg-card p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="text-sm font-medium" title={fullDate(entry.cookedAt)}>
              {formatDate(entry.cookedAt)}
            </span>
            {entry.source === "rating" && (
              <span
                className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                title="Rated without logging a cook — not counted in the cook count"
              >
                Rating only
              </span>
            )}
            {entry.rating != null && (
              <div className="mt-1 flex items-center gap-2">
                <StarRating value={entry.rating} readonly size="sm" />
                <span className="text-xs text-muted-foreground">
                  {entry.rating / 2}/5{(entry.memberRatings?.length ?? 0) > 1 ? " · everyone's average" : ""}
                </span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 bg-gradient-to-r from-orange-500 to-rose-500 px-3 text-xs text-white shadow-sm hover:opacity-95"
              onClick={() => setEditing(true)}
              title="Edit this entry"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              title="Delete this entry"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <>
            {entry.occasion && (
              <p className="text-sm text-muted-foreground">{entry.occasion}</p>
            )}

            {(entry.cookedFor?.length || entry.memberRatings?.length) ? (
              <div className="flex flex-wrap gap-1.5">
                {/* Everyone who ate, plus anyone who rated without being listed as eating */}
                {[
                  ...(entry.cookedFor ?? []),
                  ...(entry.memberRatings ?? [])
                    .map((m) => m.name)
                    .filter((n) => !(entry.cookedFor ?? []).some((c) => sameName(c, n))),
                ].map((name) => {
                  const r = entry.memberRatings?.find((m) => sameName(m.name, name))?.rating;
                  return (
                    <span
                      key={name}
                      className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                    >
                      {name}
                      {r != null && <span className="ml-1 font-semibold">★ {r / 2}</span>}
                    </span>
                  );
                })}
              </div>
            ) : null}

            {entry.actualDuration && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Took {entry.actualDuration} min
              </p>
            )}

            {entry.photoUrl && (
              <a
                href={entry.photoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block overflow-hidden rounded-lg"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.photoUrl}
                  alt="Dish photo"
                  className="aspect-video w-full object-cover"
                />
              </a>
            )}

            {entry.notes ? (
              <div className="mt-2 border-t pt-2">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                  Your notes
                </p>
                <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {entry.notes}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60">No notes for this cook.</p>
            )}
        </>
      </div>

      <CookReviewSheet
        open={editing}
        onOpenChange={setEditing}
        title="Edit this cook"
        recipeTitle={recipeTitle}
        target={{ cookId: entry.id }}
        initial={{
          duration: entry.actualDuration,
          rating: entry.rating,
          cookedFor: entry.cookedFor,
          memberRatings: entry.memberRatings,
          occasion: entry.occasion,
          notes: entry.notes,
          photoUrl: entry.photoUrl,
        }}
        members={members}
        ownName={ownName}
        storageAvailable={storageAvailable}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this entry?</DialogTitle>
            <DialogDescription>
              The cook from {formatDate(entry.cookedAt).toLowerCase()} will be removed, along with
              its rating and notes. This also updates the recipe&apos;s average rating and cook
              count. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={handleDelete}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
