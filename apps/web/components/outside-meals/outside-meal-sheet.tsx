"use client";

/**
 * Log — or plan — a meal not cooked from the library: eaten out, a takeaway,
 * at friends', skipped. One sheet for adding and editing, opened from the
 * planner's "Not cooking" button and from an outside meal's card.
 *
 * Saving writes the meal, uploads any photos, then (for a meal already eaten)
 * waits for the household's AI to estimate its nutrition and shows the result
 * before closing — what it came to, and which weekly protein targets it
 * counts towards. A future date is a plan: only what's needed to keep the
 * slot free, with a reminder to log what was eaten afterwards.
 *
 * More than one course (starter, main, dessert) gets a card each — its words
 * or menu line, printed kcal and photo — and is estimated course by course.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Camera,
  FileText,
  Loader2,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { Button, Input, Sheet, SheetContent, SheetHeader, SheetTitle, Textarea, cn } from "@dishes/ui";
import {
  MEAL_TYPES,
  OUTSIDE_MEAL_COURSE_LABELS,
  OUTSIDE_MEAL_COURSES,
  OUTSIDE_MEAL_KIND_LABELS,
  OUTSIDE_MEAL_KINDS,
  OUTSIDE_MEAL_PORTION_LABELS,
  OUTSIDE_MEAL_PORTIONS,
  type MealType,
  type OutsideMealCourseType,
  type OutsideMealKind,
  type OutsideMealPortion,
} from "@dishes/shared";
import { StarRating } from "@/app/(app)/recipes/[id]/_components/star-rating";
import {
  createOutsideMeal,
  deleteOutsideMeal,
  estimateOutsideMeal,
  updateOutsideMeal,
  uploadOutsideMealPhoto,
} from "@/app/actions/outside-meals";
import { ownRating } from "@/lib/cook-ratings";
import {
  isOutsideMealDescribed,
  outsideMealIngredientNames,
  usesMenuKcal,
  type OutsideMealView,
} from "@/lib/outside-meals";
import { PROTEIN_LABELS, proteinsOf } from "@/lib/meal-stats";
import type { ReviewMember } from "@/components/cook-review/cook-review-form";

export const OUTSIDE_MEAL_KIND_ICON: Record<OutsideMealKind, typeof UtensilsCrossed> = {
  eat_out: UtensilsCrossed,
  takeaway: ShoppingBag,
  at_friends: Users,
  skipped: Ban,
};

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  dessert: "Dessert",
  snack: "Snack",
};

/** Today on this device's clock, YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const COURSE_PLACEHOLDER: Record<OutsideMealCourseType, string> = {
  starter: "Salt & pepper squid, aioli",
  main: "8oz ribeye, triple-cooked chips, peppercorn sauce",
  side: "Onion rings",
  dessert: "Sticky toffee pudding, vanilla ice cream",
  drink: "Large glass of red",
};

type CourseDraft = {
  id: string;
  course: OutsideMealCourseType;
  text: string;
  menuKcal: string;
  file: File | null;
  preview: string | null;
  /** The photo already saved, unless removed. */
  stored: string | null;
  removePhoto: boolean;
};

type Draft = {
  kind: OutsideMealKind;
  date: string;
  mealType: MealType;
  title: string;
  place: string;
  description: string;
  menuText: string;
  menuKcal: string;
  portion: OutsideMealPortion;
  eatenBy: string[];
  rating: number | null;
  notes: string;
  plateFile: File | null;
  platePreview: string | null;
  menuFile: File | null;
  menuPreview: string | null;
  removePhoto: boolean;
  removeMenuPhoto: boolean;
  courses: CourseDraft[];
};

function draftFrom(
  meal: OutsideMealView | null | undefined,
  defaults: { date: string; mealType?: MealType; kind?: OutsideMealKind },
  ownName: string | null
): Draft {
  return {
    kind: meal?.kind ?? defaults.kind ?? "eat_out",
    date: meal?.date ?? defaults.date,
    mealType: meal?.mealType ?? defaults.mealType ?? "dinner",
    title: meal?.title ?? "",
    place: meal?.place ?? "",
    description: meal?.description ?? "",
    menuText: meal?.menuText ?? "",
    menuKcal: meal?.menuKcal ? String(meal.menuKcal) : "",
    portion: meal?.portion ?? "typical",
    eatenBy: meal?.eatenBy ?? [],
    rating: meal ? ownRating({ rating: meal.rating, memberRatings: meal.memberRatings }, ownName).own : null,
    notes: meal?.notes ?? "",
    plateFile: null,
    platePreview: null,
    menuFile: null,
    menuPreview: null,
    removePhoto: false,
    removeMenuPhoto: false,
    courses: (meal?.courses ?? []).map((c) => ({
      id: c.id,
      course: c.course,
      text: c.text ?? "",
      menuKcal: c.menuKcal ? String(c.menuKcal) : "",
      file: null,
      preview: null,
      stored: c.photoUrl,
      removePhoto: false,
    })),
  };
}

/** "850" → 850; "" → null; anything else → NaN, which the save refuses. */
function kcalOf(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 && n < 10000 ? n : NaN;
}

const chip = (active: boolean) =>
  cn(
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active
      ? "border-primary bg-primary text-primary-foreground shadow-sm"
      : "border-orange-200 bg-orange-50 text-orange-800 hover:border-orange-300 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300"
  );

const fieldClass =
  "w-full rounded-lg border bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export function OutsideMealSheet({
  open,
  onOpenChange,
  meal,
  defaults,
  members,
  ownName,
  storageAvailable,
  plannedInSlot = [],
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The meal being edited; absent to add one. */
  meal?: OutsideMealView | null;
  defaults: { date: string; mealType?: MealType; kind?: OutsideMealKind };
  members: ReviewMember[];
  ownName: string | null;
  storageAvailable: boolean;
  /** Recipes still planned in this slot — they won't be cooked, so say so. */
  plannedInSlot?: string[];
  /** After a save (the meal) or a delete (null). */
  onSaved: (meal: OutsideMealView | null) => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(meal, defaults, ownName));
  const [saving, setSaving] = useState<null | "saving" | "estimating" | "deleting">(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ meal: OutsideMealView; estimateError: string | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = (patch: Partial<Draft>) => setD((s) => ({ ...s, ...patch }));

  // Start from the meal's current values each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setD(draftFrom(meal, defaults, ownName));
    setError(null);
    setResult(null);
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isPlan = d.date > localToday();
  const skipped = d.kind === "skipped";
  const names = [
    ...members.map((m) => m.displayName),
    ...d.eatenBy.filter((n) => !members.some((m) => m.displayName === n)),
  ];

  function setPhoto(slot: "plate" | "menu", file: File | null) {
    if (slot === "plate") {
      if (d.platePreview) URL.revokeObjectURL(d.platePreview);
      update({ plateFile: file, platePreview: file ? URL.createObjectURL(file) : null, removePhoto: !file });
    } else {
      if (d.menuPreview) URL.revokeObjectURL(d.menuPreview);
      update({ menuFile: file, menuPreview: file ? URL.createObjectURL(file) : null, removeMenuPhoto: !file });
    }
  }

  function addCourse(course: OutsideMealCourseType) {
    const draft: CourseDraft = {
      id: crypto.randomUUID(),
      course,
      text: "",
      menuKcal: "",
      file: null,
      preview: null,
      stored: null,
      removePhoto: false,
    };
    // Kept in eating order, as they're shown everywhere else.
    const rank = (c: OutsideMealCourseType) => OUTSIDE_MEAL_COURSES.indexOf(c);
    const at = d.courses.findIndex((c) => rank(c.course) > rank(course));
    const courses = [...d.courses];
    courses.splice(at === -1 ? courses.length : at, 0, draft);
    update({ courses });
  }

  function updateCourse(id: string, patch: Partial<CourseDraft>) {
    update({ courses: d.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }

  function removeCourse(id: string) {
    const gone = d.courses.find((c) => c.id === id);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    update({ courses: d.courses.filter((c) => c.id !== id) });
  }

  function setCoursePhoto(id: string, file: File | null) {
    const c = d.courses.find((x) => x.id === id);
    if (c?.preview) URL.revokeObjectURL(c.preview);
    updateCourse(id, {
      file,
      preview: file ? URL.createObjectURL(file) : null,
      ...(file ? {} : { stored: null, removePhoto: !!c?.stored || c?.removePhoto }),
    });
  }

  async function handleSave() {
    setError(null);
    const hasCourses = d.courses.length > 0;
    const menuKcal = hasCourses ? null : kcalOf(d.menuKcal);
    if (Number.isNaN(menuKcal) || d.courses.some((c) => Number.isNaN(kcalOf(c.menuKcal)))) {
      setError("Menu calories should be a whole number, like 850.");
      return;
    }

    const fields = {
      date: d.date,
      mealType: d.mealType,
      kind: d.kind,
      title: d.title,
      place: d.place,
      description: skipped ? null : d.description,
      menuText: skipped || isPlan ? (meal?.menuText ?? null) : d.menuText,
      menuKcal: skipped || isPlan ? (meal?.menuKcal ?? null) : menuKcal,
      portion: d.portion,
      eatenBy: d.eatenBy.length ? d.eatenBy : null,
      notes: d.notes,
      // A plan or a skipped meal keeps its courses: they aren't on the form for it.
      ...(skipped || isPlan
        ? {}
        : {
            courses: hasCourses
              ? d.courses.map((c) => ({
                  id: c.id,
                  course: c.course,
                  text: c.text,
                  menuKcal: kcalOf(c.menuKcal),
                  removePhoto: c.removePhoto && !c.file,
                }))
              : null,
          }),
    };

    setSaving("saving");
    try {
      let saved: OutsideMealView;
      let stale = !meal;
      if (meal) {
        const res = await updateOutsideMeal(meal.id, {
          ...fields,
          // Your own stars, filed under your name; nobody else's change.
          ...(isPlan || skipped ? {} : { rating: d.rating }),
          removePhoto: d.removePhoto && !d.plateFile,
          removeMenuPhoto: d.removeMenuPhoto && !d.menuFile,
        });
        if (!res.meal) throw new Error(res.error ?? "Couldn't save — please try again.");
        saved = res.meal;
        stale = !!res.staleEstimate;
      } else {
        const res = await createOutsideMeal({ ...fields, rating: isPlan || skipped ? null : d.rating });
        if (!res.meal) throw new Error(res.error ?? "Couldn't save — please try again.");
        saved = res.meal;
      }

      for (const [slot, file] of [["plate", d.plateFile], ["menu", d.menuFile]] as const) {
        if (!file || !storageAvailable) continue;
        const fd = new FormData();
        fd.append("photo", file);
        const up = await uploadOutsideMealPhoto(saved.id, slot, fd);
        if (up.error) throw new Error(up.error);
        stale = true;
        saved = { ...saved, [slot === "menu" ? "menuPhotoUrl" : "photoUrl"]: up.url ?? null };
      }
      if (!skipped && !isPlan && storageAvailable) {
        for (const c of d.courses) {
          if (!c.file) continue;
          const fd = new FormData();
          fd.append("photo", c.file);
          const up = await uploadOutsideMealPhoto(saved.id, "course", fd, c.id);
          if (up.error) throw new Error(up.error);
          stale = true;
          saved = {
            ...saved,
            courses: saved.courses.map((x) => (x.id === c.id ? { ...x, photoUrl: up.url ?? null } : x)),
          };
        }
      }

      const describable = isOutsideMealDescribed(saved);
      const wantsEstimate =
        !isPlan &&
        !skipped &&
        describable &&
        saved.nutritionSource !== "manual" &&
        (stale || saved.nutritionSource === "none");

      if (!wantsEstimate) {
        onSaved(saved);
        onOpenChange(false);
        return;
      }

      setSaving("estimating");
      const est = await estimateOutsideMeal(saved.id);
      setResult({ meal: est.meal ?? saved, estimateError: est.meal ? null : (est.error ?? null) });
      onSaved(est.meal ?? saved);
    } catch (e) {
      setError((e as Error).message || "Couldn't save — please try again.");
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete() {
    if (!meal) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving("deleting");
    const res = await deleteOutsideMeal(meal.id);
    setSaving(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved(null);
    onOpenChange(false);
  }

  const hasCourses = d.courses.length > 0;
  const shownPlate = d.platePreview ?? (d.removePhoto ? null : meal?.photoUrl ?? null);
  const shownMenu = d.menuPreview ?? (d.removeMenuPhoto ? null : meal?.menuPhotoUrl ?? null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-h-[92dvh] overflow-y-auto px-4 pb-8 sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
        <SheetHeader className="mb-5">
          <SheetTitle>{meal ? OUTSIDE_MEAL_KIND_LABELS[d.kind] : isPlan ? "Not cooking" : "Log a meal out"}</SheetTitle>
          <p className="text-sm text-muted-foreground">
            {result
              ? "Saved."
              : isPlan
                ? "Keeps the slot free — no reminder, and the AI planner leaves it alone."
                : "Counts towards the week's nutrition, like a meal from the plan."}
          </p>
        </SheetHeader>

        {result ? (
          <EstimateResult meal={result.meal} error={result.estimateError} onDone={() => onOpenChange(false)} />
        ) : (
          <div className="space-y-6">
            {/* What kind of not-cooking */}
            <div className="grid grid-cols-4 gap-2">
              {OUTSIDE_MEAL_KINDS.map((k) => {
                const Icon = OUTSIDE_MEAL_KIND_ICON[k];
                const active = d.kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => update({ kind: k })}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-xl border-2 px-1 py-2.5 text-xs font-semibold transition-all",
                      active
                        ? "border-orange-400 bg-gradient-to-br from-orange-100 to-rose-100 text-orange-900 shadow-md dark:from-orange-950/60 dark:to-rose-950/40 dark:text-orange-100"
                        : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted"
                    )}
                    aria-pressed={active}
                  >
                    <Icon className="h-5 w-5" />
                    {OUTSIDE_MEAL_KIND_LABELS[k]}
                  </button>
                );
              })}
            </div>

            {/* When */}
            <div className="space-y-2">
              <label className="text-sm font-medium">When?</label>
              <input
                type="date"
                value={d.date}
                onChange={(e) => e.target.value && update({ date: e.target.value })}
                className={fieldClass}
              />
              <div className="flex flex-wrap gap-2">
                {MEAL_TYPES.map((t) => (
                  <button key={t} type="button" onClick={() => update({ mealType: t })} className={chip(d.mealType === t)}>
                    {MEAL_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
              {plannedInSlot.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {plannedInSlot.join(", ")} {plannedInSlot.length === 1 ? "is" : "are"} still planned here. It won&rsquo;t count
                  towards the week&rsquo;s nutrition — move it to another day if you still want to make it.
                </p>
              )}
            </div>

            {!skipped && (
              <>
                {/* What and where */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{isPlan ? "Where, or what? (optional)" : "What did you have?"}</label>
                  <Input
                    placeholder={
                      hasCourses
                        ? "Optional — named from the courses"
                        : d.kind === "takeaway"
                          ? "Chicken tikka masala, pilau rice"
                          : "Ribeye steak & chips"
                    }
                    value={d.title}
                    maxLength={200}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                  <Input
                    placeholder={d.kind === "at_friends" ? "Whose house?" : "Where from?"}
                    value={d.place}
                    maxLength={200}
                    onChange={(e) => update({ place: e.target.value })}
                  />
                  {!isPlan && (
                    <Textarea
                      placeholder={
                        hasCourses
                          ? "Anything else — bread for the table, sides to share, drinks…"
                          : "Anything else on the plate — sides, sauces, bread, dessert…"
                      }
                      value={d.description}
                      onChange={(e) => update({ description: e.target.value })}
                      rows={2}
                      className="resize-none"
                    />
                  )}
                </div>

                {!isPlan && (
                  <CoursesField
                    courses={d.courses}
                    storageAvailable={storageAvailable}
                    onAdd={addCourse}
                    onChange={updateCourse}
                    onRemove={removeCourse}
                    onPhoto={setCoursePhoto}
                  />
                )}

                {!isPlan && (
                  <>
                    {/* The menu: the best clue to what's in it */}
                    <div className="space-y-2 rounded-xl bg-gradient-to-br from-sky-50 to-indigo-50 p-3 shadow-sm dark:from-sky-950/30 dark:to-indigo-950/30">
                      <label className="flex items-center gap-1.5 text-sm font-semibold text-sky-900 dark:text-sky-200">
                        <FileText className="h-4 w-4" />
                        From the menu
                      </label>
                      <p className="text-xs text-muted-foreground">
                        {hasCourses
                          ? "Each course's line can go on its card — or paste the menu here and the AI matches them up."
                          : "The menu’s description says what’s in the dish — the best guide to its nutrition."}
                      </p>
                      <Textarea
                        placeholder={hasCourses ? "Paste or type the lines from the menu" : "Paste or type the dish's line from the menu"}
                        value={d.menuText}
                        onChange={(e) => update({ menuText: e.target.value })}
                        rows={2}
                        className="resize-none bg-background/80"
                      />
                      {!hasCourses && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={9999}
                            placeholder="kcal"
                            value={d.menuKcal}
                            onChange={(e) => update({ menuKcal: e.target.value })}
                            className={cn(fieldClass, "w-24 bg-background/80")}
                            aria-label="Calories printed on the menu"
                          />
                          <span className="text-xs text-muted-foreground">
                            kcal printed on the menu, if it shows them — used as given
                          </span>
                        </div>
                      )}
                      {storageAvailable && (
                        <PhotoField
                          label="Photo of the menu"
                          url={shownMenu}
                          onPick={(f) => setPhoto("menu", f)}
                          compact
                        />
                      )}
                    </div>

                    {/* With courses, each has its own photo; a table photo stays if there is one. */}
                    {storageAvailable && (!hasCourses || shownPlate) && (
                      <PhotoField
                        label={hasCourses ? "Photo of the table" : "Photo of the plate"}
                        url={shownPlate}
                        onPick={(f) => setPhoto("plate", f)}
                      />
                    )}

                    {/* Portion */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">How big was it?</label>
                      <div className="flex flex-wrap gap-2">
                        {OUTSIDE_MEAL_PORTIONS.map((p) => (
                          <button key={p} type="button" onClick={() => update({ portion: p })} className={chip(d.portion === p)}>
                            {OUTSIDE_MEAL_PORTION_LABELS[p]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* Who */}
            {names.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{isPlan ? "Who's going?" : skipped ? "Who skipped it?" : "Who ate?"}</label>
                <div className="flex flex-wrap gap-2">
                  {names.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() =>
                        update({
                          eatenBy: d.eatenBy.includes(name) ? d.eatenBy.filter((n) => n !== name) : [...d.eatenBy, name],
                        })
                      }
                      className={chip(d.eatenBy.includes(name))}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Nobody picked means everyone.</p>
              </div>
            )}

            {!isPlan && !skipped && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{ownName ? `${ownName}, how was it?` : "How was it?"}</label>
                <div className="flex items-center gap-3">
                  <StarRating value={d.rating} onChange={(rating) => update({ rating })} size="lg" />
                  {d.rating != null && (
                    <button type="button" onClick={() => update({ rating: null })} className="text-xs text-muted-foreground underline">
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                placeholder={isPlan ? "Booked for 7:30…" : "Worth going back? What would you order next time?"}
                value={d.notes}
                onChange={(e) => update({ notes: e.target.value })}
                rows={2}
                className="resize-none"
              />
            </div>

            {isPlan && !skipped && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                Afterwards, open this again to add what you had — a menu photo or description is enough for an estimate.
              </p>
            )}

            {error && <p className="text-center text-sm text-destructive">{error}</p>}

            <Button className="w-full bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-md hover:from-orange-600 hover:to-rose-600" onClick={handleSave} disabled={!!saving}>
              {saving === "saving" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : saving === "estimating" ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                  Estimating nutrition…
                </>
              ) : meal ? (
                "Save"
              ) : isPlan ? (
                "Keep this slot free"
              ) : (
                "Log it"
              )}
            </Button>

            {meal && (
              <Button
                variant="outline"
                className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={handleDelete}
                disabled={!!saving}
              >
                {saving === "deleting" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                {confirmDelete ? "Tap again to remove it" : "Remove"}
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const COURSE_STYLE: Record<OutsideMealCourseType, string> = {
  starter: "from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30",
  main: "from-orange-50 to-rose-50 dark:from-orange-950/30 dark:to-rose-950/30",
  side: "from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/20",
  dessert: "from-pink-50 to-fuchsia-50 dark:from-pink-950/30 dark:to-fuchsia-950/30",
  drink: "from-sky-50 to-indigo-50 dark:from-sky-950/30 dark:to-indigo-950/30",
};

/** A card per course, and buttons to add one of each kind. */
function CoursesField({
  courses,
  storageAvailable,
  onAdd,
  onChange,
  onRemove,
  onPhoto,
}: {
  courses: CourseDraft[];
  storageAvailable: boolean;
  onAdd: (course: OutsideMealCourseType) => void;
  onChange: (id: string, patch: Partial<CourseDraft>) => void;
  onRemove: (id: string) => void;
  onPhoto: (id: string, file: File | null) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{courses.length ? "Courses" : "More than one course?"}</label>
      {courses.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Add a starter, dessert or drinks and each is estimated on its own, with its own menu kcal and photo.
        </p>
      )}
      {courses.map((c) => (
        <div key={c.id} className={cn("space-y-2 rounded-xl bg-gradient-to-br p-3 shadow-sm", COURSE_STYLE[c.course])}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{OUTSIDE_MEAL_COURSE_LABELS[c.course]}</span>
            <button
              type="button"
              onClick={() => onRemove(c.id)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-background/70 text-muted-foreground shadow-sm hover:text-destructive"
              aria-label={`Remove the ${OUTSIDE_MEAL_COURSE_LABELS[c.course].toLowerCase()}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <Textarea
            placeholder={COURSE_PLACEHOLDER[c.course]}
            value={c.text}
            onChange={(e) => onChange(c.id, { text: e.target.value })}
            rows={2}
            maxLength={2000}
            className="resize-none bg-background/80"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={9999}
              placeholder="kcal"
              value={c.menuKcal}
              onChange={(e) => onChange(c.id, { menuKcal: e.target.value })}
              className={cn(fieldClass, "w-24 bg-background/80")}
              aria-label={`Calories printed on the menu for the ${OUTSIDE_MEAL_COURSE_LABELS[c.course].toLowerCase()}`}
            />
            <span className="text-xs text-muted-foreground">kcal on the menu, if shown</span>
          </div>
          {storageAvailable && (
            <PhotoField
              label={`Photo of the ${OUTSIDE_MEAL_COURSE_LABELS[c.course].toLowerCase()}`}
              url={c.preview ?? c.stored}
              onPick={(f) => onPhoto(c.id, f)}
              compact
            />
          )}
        </div>
      ))}
      {courses.length < 8 && (
        <div className="flex flex-wrap gap-2">
          {OUTSIDE_MEAL_COURSES.map((course) => (
            <button
              key={course}
              type="button"
              onClick={() => onAdd(course)}
              className="flex items-center gap-1 rounded-full border border-orange-300 bg-gradient-to-br from-orange-50 to-rose-50 px-3 py-1 text-xs font-semibold text-orange-800 shadow-sm hover:border-orange-400 dark:border-orange-900 dark:from-orange-950/40 dark:to-rose-950/30 dark:text-orange-300"
            >
              <Plus className="h-3.5 w-3.5" />
              {OUTSIDE_MEAL_COURSE_LABELS[course]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoField({
  label,
  url,
  onPick,
  compact = false,
}: {
  label: string;
  url: string | null;
  onPick: (file: File | null) => void;
  compact?: boolean;
}) {
  if (url) {
    return (
      <div className="relative overflow-hidden rounded-lg shadow-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className={cn("w-full object-cover", compact ? "max-h-40" : "aspect-video")} />
        <div className="absolute right-2 top-2 flex gap-1.5">
          <label className="flex h-8 cursor-pointer items-center gap-1 rounded-full bg-black/55 px-3 text-xs font-medium text-white hover:bg-black/70">
            <Camera className="h-3.5 w-3.5" />
            Replace
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          </label>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70"
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <label
      className={cn(
        "flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-orange-300 bg-orange-50/60 px-4 text-sm font-medium text-orange-800 transition-colors hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300",
        compact ? "py-3" : "py-6"
      )}
    >
      <Camera className="h-5 w-5" />
      {label}
      <input type="file" accept="image/*" className="sr-only" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </label>
  );
}

/** Per portion as eaten: the eight figures, plus what it counts towards. */
export function OutsideMealNutrition({ meal }: { meal: OutsideMealView }) {
  const proteins = useMemo(() => [...proteinsOf(outsideMealIngredientNames(meal))], [meal]);
  const rows: [string, number | null, string][] = [
    ["Protein", meal.proteinG, "g"],
    ["Carbs", meal.carbsG, "g"],
    ["Fat", meal.fatG, "g"],
    ["Sat fat", meal.saturatedFatG, "g"],
    ["Fibre", meal.fiberG, "g"],
    ["Sugar", meal.sugarG, "g"],
    ["Sodium", meal.sodiumMg, "mg"],
  ];
  return (
    <div className="space-y-3">
      {meal.calories != null && (
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums">{meal.calories.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">kcal</span>
          <span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
            {meal.nutritionSource === "manual"
              ? "Entered"
              : usesMenuKcal(meal)
                ? "kcal from the menu · rest estimated"
                : "Estimate"}
          </span>
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        {rows.map(([label, value, unit]) => (
          <div key={label} className="rounded-lg bg-background/70 px-2 py-1.5 text-center shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-sm font-semibold tabular-nums">
              {value == null ? "—" : `${unit === "mg" ? Math.round(value) : value}${unit}`}
            </p>
          </div>
        ))}
      </div>
      {proteins.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Counts towards this week&rsquo;s{" "}
          <span className="font-semibold text-foreground">{proteins.map((k) => PROTEIN_LABELS[k].toLowerCase()).join(", ")}</span>
        </p>
      )}
    </div>
  );
}

/** Each course: what it was and its share of the calories, once estimated. */
export function OutsideMealCourses({ meal }: { meal: OutsideMealView }) {
  return (
    <ul className="space-y-1.5">
      {meal.courses.map((c) => (
        <li key={c.id} className="flex items-baseline gap-2 rounded-lg bg-background/70 px-2.5 py-1.5 text-sm shadow-sm">
          <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {OUTSIDE_MEAL_COURSE_LABELS[c.course]}
          </span>
          <span className="min-w-0 flex-1 truncate">{c.name ?? c.text ?? "—"}</span>
          {c.calories != null && (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {c.menuKcal ? "" : "≈ "}
              {c.calories.toLocaleString()} kcal
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function EstimateResult({
  meal,
  error,
  onDone,
}: {
  meal: OutsideMealView;
  error: string | null;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4">
      {meal.calories != null ? (
        <div className="space-y-2 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4 shadow-sm dark:border-violet-800 dark:from-violet-950/40 dark:to-fuchsia-950/30">
          <div className="flex items-center gap-2 text-violet-700 dark:text-violet-400">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="text-sm font-semibold">{meal.title ?? "Your meal"}</span>
          </div>
          {meal.courses.length ? (
            <OutsideMealCourses meal={meal} />
          ) : meal.components?.length ? (
            <p className="text-xs text-muted-foreground">{meal.components.join(" · ")}</p>
          ) : null}
          {error && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {error} These are the figures from before.
            </p>
          )}
          <OutsideMealNutrition meal={meal} />
          <p className="text-[11px] text-muted-foreground">
            Restaurant food is hard to pin down — hidden butter and oil, unknown portions — so treat this as a rough guide.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {error ?? "No estimate this time."} The meal is saved; its protein still counts from what you described.
        </div>
      )}
      <Button className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
