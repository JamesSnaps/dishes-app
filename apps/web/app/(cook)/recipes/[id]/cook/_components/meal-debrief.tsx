"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Loader2, MessageSquarePlus, X } from "lucide-react";
import { Button, Textarea } from "@dishes/ui";
import { StarRating } from "@/app/(app)/recipes/[id]/_components/star-rating";
import { CookReviewFields, useCookReview } from "@/components/cook-review/cook-review-form";
import { logMealCook } from "@/app/actions/meal-cooks";
import { uploadCookPhoto } from "@/app/actions/cook-history";
import { sameName } from "@/lib/cook-ratings";

type Dish = { id: string; title: string; imageUrl: string | null };

/**
 * One review at the end of a planned meal, instead of one per dish: the meal
 * as a whole (stars, who ate and what they thought, occasion, notes, photo),
 * then a quick star row for each dish, notes optional. Anything skipped just
 * isn't rated. Saved as one meal cook with a cook entry per dish
 * (lib/services/meal-cooks.ts); the photo goes on the main dish's entry.
 */
export function MealDebrief({
  groupId,
  title,
  dishes,
  elapsedMinutes,
  householdMembers,
  ownName,
  storageAvailable,
  onCancel,
  onDone,
}: {
  groupId: string;
  title: string;
  /** Main first. */
  dishes: Dish[];
  elapsedMinutes: number;
  householdMembers: { id: string; displayName: string }[];
  ownName: string | null;
  storageAvailable: boolean;
  onCancel: () => void;
  /** Ends the cook (every dish) — called once it's saved. */
  onDone: () => void;
}) {
  const router = useRouter();
  const { state: review, update } = useCookReview({ duration: elapsedMinutes });
  const [dishRatings, setDishRatings] = useState<Record<string, number | null>>({});
  const [dishNotes, setDishNotes] = useState<Record<string, string>>({});
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(later = false) {
    setSaving(true);
    setError(null);
    try {
      const memberRatings = later
        ? null
        : review.cookedFor
            .filter((n) => review.memberRatings[n] != null && !(ownName && sameName(n, ownName)))
            .map((name) => ({ name, rating: review.memberRatings[name]! }));
      const result = await logMealCook({
        groupId,
        rating: later ? null : review.rating,
        memberRatings: memberRatings?.length ? memberRatings : null,
        cookedFor: review.cookedFor.length ? review.cookedFor : null,
        occasion: review.occasion.trim() || null,
        notes: later ? null : review.notes.trim() || null,
        actualDuration: review.duration,
        dishes: dishes.map((d) => ({
          recipeId: d.id,
          rating: later ? null : dishRatings[d.id] ?? null,
          notes: later ? null : dishNotes[d.id]?.trim() || null,
        })),
      });
      const mainCook = dishes[0] ? result.cookIds[dishes[0].id] : undefined;
      if (!later && review.photoFile && storageAvailable && mainCook) {
        const fd = new FormData();
        fd.append("photo", review.photoFile);
        await uploadCookPhoto(mainCook, fd);
      }
      onDone();
      router.push("/meal-plan");
    } catch {
      setSaving(false);
      setError("Couldn't save the meal — please try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-lg flex-1 px-5 py-6">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400">
              Meal finished
            </p>
            <h2 className="text-2xl font-bold">{title}</h2>
            <p className="text-sm text-muted-foreground">How did the whole meal go?</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
            aria-label="Back to cooking"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <CookReviewFields
          state={review}
          update={update}
          members={householdMembers}
          storageAvailable={storageAvailable}
          ownName={ownName}
        />

        <div className="mt-8 rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-4 shadow-sm dark:border-orange-900/60 dark:from-orange-950/30 dark:to-amber-950/20">
          <p className="mb-1 text-sm font-semibold">Each dish</p>
          <p className="mb-4 text-xs text-muted-foreground">
            A quick rating for each part — skip any you like. These go on each recipe&apos;s own history.
          </p>
          <ul className="space-y-3">
            {dishes.map((d) => (
              <li key={d.id} className="rounded-xl bg-white/80 p-3 shadow-sm dark:bg-black/30">
                <div className="flex items-center gap-3">
                  {d.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <ChefHat className="h-4 w-4 text-muted-foreground" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{d.title}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setNotesOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                        return next;
                      })
                    }
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Notes on ${d.title}`}
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <StarRating
                    value={dishRatings[d.id] ?? null}
                    onChange={(r) => setDishRatings((prev) => ({ ...prev, [d.id]: r }))}
                    size="md"
                  />
                  {dishRatings[d.id] != null && (
                    <button
                      type="button"
                      onClick={() => setDishRatings((prev) => ({ ...prev, [d.id]: null }))}
                      className="text-xs text-muted-foreground underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {notesOpen.has(d.id) && (
                  <Textarea
                    value={dishNotes[d.id] ?? ""}
                    onChange={(e) => setDishNotes((prev) => ({ ...prev, [d.id]: e.target.value }))}
                    rows={2}
                    placeholder={`Anything about the ${d.title.toLowerCase()}?`}
                    className="mt-2 text-sm"
                  />
                )}
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <div className="mt-6 flex flex-col gap-2 pb-8">
          <Button
            size="lg"
            onClick={() => save(false)}
            disabled={saving}
            className="bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-md hover:from-orange-600 hover:to-rose-600"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save the meal
          </Button>
          <Button size="lg" variant="outline" onClick={() => save(true)} disabled={saving}>
            Review later
          </Button>
        </div>
      </div>
    </div>
  );
}
