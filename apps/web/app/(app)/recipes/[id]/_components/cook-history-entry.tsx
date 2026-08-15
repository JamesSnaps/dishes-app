"use client";

import { useState, useTransition } from "react";
import { Clock, Pencil, Trash2, X, Check } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@dishes/ui";
import { StarRating } from "./star-rating";
import { deleteCookEntry, updateCookEntry } from "@/app/actions/cook-history";
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
export function CookHistoryEntryCard({ entry }: { entry: Entry }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const [rating, setRating] = useState<number | null>(entry.rating);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [occasion, setOccasion] = useState(entry.occasion ?? "");

  function handleSave() {
    startTransition(async () => {
      await updateCookEntry(entry.id, { rating, notes, occasion });
      setEditing(false);
    });
  }

  function handleCancel() {
    setRating(entry.rating);
    setNotes(entry.notes ?? "");
    setOccasion(entry.occasion ?? "");
    setEditing(false);
  }

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
            {!editing && entry.rating != null && (
              <div className="mt-1 flex items-center gap-2">
                <StarRating value={entry.rating} readonly size="sm" />
                <span className="text-xs text-muted-foreground">{entry.rating / 2}/5</span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {editing ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleCancel}
                  disabled={pending}
                  title="Discard changes"
                >
                  <X className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleSave}
                  disabled={pending}
                  title="Save changes"
                >
                  <Check className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setEditing(true)}
                  title="Edit this entry"
                >
                  <Pencil className="h-3.5 w-3.5" />
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
              </>
            )}
          </div>
        </div>

        {editing ? (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-3">
              <StarRating value={rating} onChange={setRating} size="sm" />
              <span className="text-xs text-muted-foreground">
                {rating != null ? `${rating / 2}/5` : "Not rated"}
              </span>
              {rating != null && (
                <button
                  type="button"
                  onClick={() => setRating(null)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
            <Input
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
              placeholder="Occasion (e.g. Sunday lunch with the Smiths)"
              className="h-9 text-sm"
            />
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What worked, what you'd change next time…"
              rows={4}
              className="text-sm"
            />
          </div>
        ) : (
          <>
            {entry.occasion && (
              <p className="text-sm text-muted-foreground">{entry.occasion}</p>
            )}

            {entry.cookedFor && entry.cookedFor.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Cooked for: {entry.cookedFor.join(", ")}
              </p>
            )}

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
        )}
      </div>

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
