"use client";

/**
 * The full cook review — duration, overall rating, who ate and what each of
 * them thought, occasion, notes and a dish photo. One form for every place a
 * review is written or edited (end of cooking mode, "Log a cook", editing a
 * history entry), so they can't drift apart again.
 *
 * `useCookReview` holds the state; `CookReviewFields` renders it;
 * `saveCookReview` writes it (log or update, photo upload, AI photo feedback).
 */

import { useState } from "react";
import { Camera, Clock, Minus, Plus, X } from "lucide-react";
import { Textarea, cn } from "@dishes/ui";
import { StarRating } from "@/app/(app)/recipes/[id]/_components/star-rating";
import { logCook, updateCookEntry, uploadCookPhoto } from "@/app/actions/cook-history";
import { reviewDishPhoto } from "@/app/actions/ai";
import type { MemberRating } from "@dishes/db/schema";
import { ownRating, sameName } from "@/lib/cook-ratings";

export const OCCASION_SUGGESTIONS = [
  "Weeknight dinner",
  "Date night",
  "Family dinner",
  "Birthday",
  "Anniversary",
  "Dinner party",
  "Meal prep",
];

export type ReviewMember = { id: string; displayName: string };

export type CookReviewState = {
  /** Minutes; null = not recorded. */
  duration: number | null;
  /** The person saving's own rating — one voice among everyone's. */
  rating: number | null;
  /** Display names of who ate, matching cook_history.cooked_for. */
  cookedFor: string[];
  /** Per-person ratings keyed by display name (0–10). */
  memberRatings: Record<string, number>;
  occasion: string;
  notes: string;
  /** A photo already stored against the entry. */
  existingPhotoUrl: string | null;
  removePhoto: boolean;
  photoFile: File | null;
  photoPreviewUrl: string | null;
};

export type CookReviewInitial = Partial<{
  duration: number | null;
  rating: number | null;
  cookedFor: string[] | null;
  memberRatings: MemberRating[] | null;
  occasion: string | null;
  notes: string | null;
  photoUrl: string | null;
  /** Who's editing: their stored voice becomes "Your rating". */
  ownName: string | null;
}>;

function toState(init: CookReviewInitial): CookReviewState {
  const { own, others } = ownRating(
    { rating: init.rating ?? null, memberRatings: init.memberRatings ?? null },
    init.ownName ?? null
  );
  return {
    duration: init.duration ?? null,
    rating: own,
    cookedFor: init.cookedFor ?? [],
    memberRatings: Object.fromEntries(others.map((r) => [r.name, r.rating])),
    occasion: init.occasion ?? "",
    notes: init.notes ?? "",
    existingPhotoUrl: init.photoUrl ?? null,
    removePhoto: false,
    photoFile: null,
    photoPreviewUrl: null,
  };
}

export function useCookReview(initial: CookReviewInitial = {}) {
  const [state, setState] = useState<CookReviewState>(() => toState(initial));
  const update = (patch: Partial<CookReviewState>) => setState((s) => ({ ...s, ...patch }));
  const reset = (init: CookReviewInitial = initial) => {
    if (state.photoPreviewUrl) URL.revokeObjectURL(state.photoPreviewUrl);
    setState(toState(init));
  };
  return { state, update, reset };
}

type SaveTarget = { cookId: string } | { recipeId: string };

/**
 * Write the review. With a cookId it edits that entry (every field); with a
 * recipeId it logs a new cook. Uploads a new photo and, if there is one, asks
 * the AI for presentation feedback — returned rather than shown, so each
 * caller can present it its own way.
 */
export async function saveCookReview(
  target: SaveTarget,
  s: CookReviewState,
  opts: { recipeTitle: string; storageAvailable: boolean; aiFeedback?: boolean; ownName?: string | null }
): Promise<{ cookId: string; photoUrl: string | null; feedback: string | null }> {
  // Your own rating travels as `rating`; the server files it under your name.
  const memberRatings: MemberRating[] = s.cookedFor
    .filter((name) => s.memberRatings[name] != null && !(opts.ownName && sameName(name, opts.ownName)))
    .map((name) => ({ name, rating: s.memberRatings[name]! }));
  const fields = {
    rating: s.rating,
    actualDuration: s.duration,
    notes: s.notes.trim() || null,
    occasion: s.occasion.trim() || null,
    cookedFor: s.cookedFor.length ? s.cookedFor : null,
    memberRatings: memberRatings.length ? memberRatings : null,
  };

  let cookId: string;
  if ("cookId" in target) {
    cookId = target.cookId;
    await updateCookEntry(cookId, { ...fields, removePhoto: s.removePhoto && !s.photoFile });
  } else {
    cookId = (await logCook(target.recipeId, fields)).id;
  }

  let photoUrl: string | null = null;
  let feedback: string | null = null;
  if (s.photoFile && opts.storageAvailable) {
    const fd = new FormData();
    fd.append("photo", s.photoFile);
    const res = await uploadCookPhoto(cookId, fd);
    if (res.error) throw new Error(res.error);
    photoUrl = res.url ?? null;
    if (photoUrl && opts.aiFeedback !== false) {
      feedback = (await reviewDishPhoto(opts.recipeTitle, photoUrl).catch(() => ({ feedback: undefined }))).feedback ?? null;
    }
  }
  return { cookId, photoUrl, feedback };
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

const chip = (active: boolean) =>
  cn(
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground shadow-sm"
      : "border-orange-200 bg-orange-50 text-orange-800 hover:border-orange-300 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300"
  );

export function CookReviewFields({
  state: s,
  update,
  members,
  storageAvailable,
  durationHint,
  ownName = null,
}: {
  state: CookReviewState;
  update: (patch: Partial<CookReviewState>) => void;
  members: ReviewMember[];
  storageAvailable: boolean;
  /** Shown beside the duration, e.g. "Recipe says 40 min — we'll update it". */
  durationHint?: string | null;
  /** The person filling it in — rated by the main stars, not in the list. */
  ownName?: string | null;
}) {
  const othersEating = s.cookedFor.filter((n) => !(ownName && sameName(n, ownName)));
  // Current members, plus anyone named on an old entry who has since left.
  const names = [
    ...members.map((m) => m.displayName),
    ...s.cookedFor.filter((n) => !members.some((m) => m.displayName === n)),
  ];

  function toggleEater(name: string) {
    const eating = s.cookedFor.includes(name);
    update({ cookedFor: eating ? s.cookedFor.filter((n) => n !== name) : [...s.cookedFor, name] });
  }

  function setMemberRating(name: string, rating: number | null) {
    const next = { ...s.memberRatings };
    if (rating == null) delete next[name];
    else next[name] = rating;
    update({ memberRatings: next });
  }

  function setPhoto(file: File | null) {
    if (s.photoPreviewUrl) URL.revokeObjectURL(s.photoPreviewUrl);
    update({ photoFile: file, photoPreviewUrl: file ? URL.createObjectURL(file) : null });
  }

  const shownPhoto = s.photoPreviewUrl ?? (s.removePhoto ? null : s.existingPhotoUrl);

  return (
    <div className="space-y-7">
      {/* Duration */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="h-4 w-4 text-muted-foreground" />
          How long did it take?
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => update({ duration: Math.max(1, (s.duration ?? 30) - 5) })}
            className="flex h-9 w-9 items-center justify-center rounded-lg border bg-muted/60 shadow-sm hover:bg-muted"
            aria-label="Decrease by 5 minutes"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-[5rem] text-center text-lg font-semibold tabular-nums">
            {s.duration != null ? formatMinutes(s.duration) : "—"}
          </span>
          <button
            type="button"
            onClick={() => update({ duration: (s.duration ?? 25) + 5 })}
            className="flex h-9 w-9 items-center justify-center rounded-lg border bg-muted/60 shadow-sm hover:bg-muted"
            aria-label="Increase by 5 minutes"
          >
            <Plus className="h-4 w-4" />
          </button>
          {s.duration != null && !durationHint && (
            <button type="button" onClick={() => update({ duration: null })} className="text-xs text-muted-foreground underline">
              Clear
            </button>
          )}
          {durationHint && <span className="text-xs text-muted-foreground">{durationHint}</span>}
        </div>
      </div>

      {/* Overall rating */}
      <div className="space-y-2">
        <label className="text-sm font-medium">{ownName ? `${ownName}, what did you think?` : "How did it go?"}</label>
        <div className="flex items-center gap-3">
          <StarRating value={s.rating} onChange={(rating) => update({ rating })} size="lg" />
          <span className="text-sm text-muted-foreground">
            {s.rating != null ? `${s.rating / 2} / 5` : "Tap to rate"}
          </span>
          {s.rating != null && (
            <button type="button" onClick={() => update({ rating: null })} className="text-xs text-muted-foreground underline">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Who ate, and what they thought */}
      {names.length > 0 && (
        <div className="space-y-3">
          <label className="text-sm font-medium">Who ate?</label>
          <div className="flex flex-wrap gap-2">
            {names.map((name) => (
              <button key={name} type="button" onClick={() => toggleEater(name)} className={chip(s.cookedFor.includes(name))}>
                {name}
              </button>
            ))}
          </div>
          {othersEating.length > 0 && (
            <div className="space-y-2 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 p-3 shadow-sm dark:from-amber-950/30 dark:to-orange-950/30">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                What did everyone think?
              </p>
              {othersEating.map((name) => (
                <div key={name} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium">{name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StarRating value={s.memberRatings[name] ?? null} onChange={(r) => setMemberRating(name, r)} size="md" />
                    {s.memberRatings[name] != null ? (
                      <button
                        type="button"
                        onClick={() => setMemberRating(name, null)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Clear ${name}'s rating`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span className="w-3.5" />
                    )}
                  </span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Everyone&rsquo;s ratings, yours included, are averaged into the recipe&rsquo;s rating.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Occasion */}
      <div className="space-y-2">
        <label className="text-sm font-medium">What was the occasion?</label>
        <div className="flex flex-wrap gap-2">
          {OCCASION_SUGGESTIONS.map((o) => (
            <button key={o} type="button" onClick={() => update({ occasion: s.occasion === o ? "" : o })} className={chip(s.occasion === o)}>
              {o}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Or write your own…"
          value={s.occasion}
          onChange={(e) => update({ occasion: e.target.value })}
          className="w-full rounded-lg border bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Any notes?</label>
        <Textarea
          placeholder="What worked well, what you'd change, substitutions you made…"
          value={s.notes}
          onChange={(e) => update({ notes: e.target.value })}
          rows={3}
          className="resize-none"
        />
      </div>

      {/* Photo */}
      {storageAvailable && (
        <div className="space-y-2">
          <label className="text-sm font-medium">How did it look?</label>
          {shownPhoto ? (
            <div className="relative overflow-hidden rounded-lg shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shownPhoto} alt="Dish" className="aspect-video w-full object-cover" />
              <div className="absolute right-2 top-2 flex gap-1.5">
                <label className="flex h-8 cursor-pointer items-center gap-1 rounded-full bg-black/55 px-3 text-xs font-medium text-white hover:bg-black/70">
                  <Camera className="h-3.5 w-3.5" />
                  Replace
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setPhoto(null);
                    update({ removePhoto: true });
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70"
                  aria-label="Remove photo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-orange-300 bg-orange-50/60 px-4 py-6 text-sm font-medium text-orange-800 transition-colors hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300">
              <Camera className="h-5 w-5" />
              Take or upload a photo of your dish
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </label>
          )}
          {s.photoFile && <p className="text-xs text-muted-foreground">AI will review your presentation after saving ✨</p>}
        </div>
      )}
    </div>
  );
}
