/**
 * Meals eaten out, as the browser and the server both see them. Pure — no
 * database — so the planner's in-browser nutrition card counts them exactly
 * as Stats does on the server.
 */

import {
  isOutsideMealCourseType,
  MEAL_TYPES,
  OUTSIDE_MEAL_COURSES,
  OUTSIDE_MEAL_KINDS,
  OUTSIDE_MEAL_PORTIONS,
  type MealType,
  type OutsideMealCourseType,
  type OutsideMealKind,
  type OutsideMealPortion,
} from "@dishes/shared";
import type { MemberRating, OutsideMealCourse } from "@dishes/db/schema";
import type { MealFacts } from "@/lib/meal-stats";

/** One course of a sitting (outside_meals.courses), its type narrowed. */
export type OutsideMealCourseView = {
  id: string;
  course: OutsideMealCourseType;
  text: string | null;
  menuKcal: number | null;
  photoUrl: string | null;
  /** From the estimate. */
  name: string | null;
  components: string[] | null;
  calories: number | null;
};

export type OutsideMealView = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  mealType: MealType;
  kind: OutsideMealKind;
  title: string | null;
  place: string | null;
  cuisine: string | null;
  description: string | null;
  menuText: string | null;
  portion: OutsideMealPortion;
  components: string[] | null;
  /** Empty for a single dish. In eating order. */
  courses: OutsideMealCourseView[];
  mainIngredients: string[] | null;
  menuKcal: number | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  saturatedFatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  nutritionSource: "none" | "ai" | "manual";
  eatenBy: string[] | null;
  rating: number | null;
  memberRatings: MemberRating[] | null;
  notes: string | null;
  photoUrl: string | null;
  menuPhotoUrl: string | null;
};

/**
 * A synced row (the raw server row, decimals as strings) as a view. Every
 * field is narrowed rather than cast: a store holding anything odd gives a
 * meal with gaps, never one that throws later.
 */
export function outsideMealFromRecord(r: Record<string, unknown> & { id: string }): OutsideMealView | null {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);
  const date = str(r.date)?.slice(0, 10);
  if (!date) return null;
  return {
    id: r.id,
    date,
    mealType: MEAL_TYPES.find((t) => t === r.mealType) ?? "dinner",
    kind: OUTSIDE_MEAL_KINDS.find((k) => k === r.kind) ?? "eat_out",
    title: str(r.title),
    place: str(r.place),
    cuisine: str(r.cuisine),
    description: str(r.description),
    menuText: str(r.menuText),
    portion: OUTSIDE_MEAL_PORTIONS.find((p) => p === r.portion) ?? "typical",
    components: strs(r.components),
    courses: coursesFrom(r.courses),
    mainIngredients: strs(r.mainIngredients),
    menuKcal: num(r.menuKcal),
    calories: num(r.calories),
    proteinG: num(r.proteinG),
    carbsG: num(r.carbsG),
    fatG: num(r.fatG),
    saturatedFatG: num(r.saturatedFatG),
    fiberG: num(r.fiberG),
    sugarG: num(r.sugarG),
    sodiumMg: num(r.sodiumMg),
    nutritionSource: r.nutritionSource === "ai" || r.nutritionSource === "manual" ? r.nutritionSource : "none",
    eatenBy: strs(r.eatenBy),
    rating: num(r.rating),
    memberRatings: Array.isArray(r.memberRatings)
      ? r.memberRatings.flatMap((x) => {
          const o = x as { name?: unknown; rating?: unknown };
          return typeof o?.name === "string" && typeof o.rating === "number" ? [{ name: o.name, rating: o.rating }] : [];
        })
      : null,
    notes: str(r.notes),
    photoUrl: str(r.photoUrl),
    menuPhotoUrl: str(r.menuPhotoUrl),
  };
}

/**
 * Stored courses as views: anything malformed dropped, unknown types dropped,
 * sorted into eating order (starter, main, side, dessert, drink) with their
 * own order kept within a type.
 */
export function coursesFrom(v: unknown): OutsideMealCourseView[] {
  if (!Array.isArray(v)) return [];
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x : null);
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const out = v.flatMap((x): OutsideMealCourseView[] => {
    const c = x as Record<string, unknown> | null;
    if (!c || typeof c.id !== "string" || !isOutsideMealCourseType(c.course)) return [];
    return [
      {
        id: c.id,
        course: c.course,
        text: str(c.text),
        menuKcal: num(c.menuKcal),
        photoUrl: str(c.photoUrl),
        name: str(c.name),
        components: Array.isArray(c.components)
          ? c.components.filter((s): s is string => typeof s === "string")
          : null,
        calories: num(c.calories),
      },
    ];
  });
  const rank = (c: OutsideMealCourseView) => OUTSIDE_MEAL_COURSES.indexOf(c.course);
  return out.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(({ c }) => c);
}

/** A course as the eater gives it; the photo goes up separately (`setOutsideMealPhoto`). */
export type OutsideMealCourseInput = {
  /** The client's own id for it, kept across edits: a UUID. */
  id: string;
  course: string;
  text?: string | null;
  menuKcal?: number | null;
  removePhoto?: boolean;
};

/**
 * The courses to store, from what's stored and what the eater sent. A course
 * keeps its photo (unless removed) and, while nothing about it changed, its
 * share of the estimate. `changed` says the estimate needs doing again.
 */
export function mergeCourses(
  stored: OutsideMealCourse[] | null,
  input: OutsideMealCourseInput[] | null
): { courses: OutsideMealCourse[] | null; changed: boolean } {
  const before = stored ?? [];
  if (!input?.length) return { courses: null, changed: before.length > 0 };
  let changed = input.length !== before.length;
  const courses = input.map((c): OutsideMealCourse => {
    const old = before.find((b) => b.id === c.id);
    const courseText = c.text?.trim() ? c.text.trim().slice(0, 2000) : null;
    const menuKcal = c.menuKcal ?? null;
    const photoUrl = c.removePhoto ? null : (old?.photoUrl ?? null);
    const same =
      !!old && old.course === c.course && old.text === courseText && old.menuKcal === menuKcal && old.photoUrl === photoUrl;
    if (!same) changed = true;
    return {
      id: c.id,
      course: c.course,
      text: courseText,
      menuKcal,
      photoUrl,
      name: same && old ? old.name : null,
      components: same && old ? old.components : null,
      calories: same && old ? old.calories : null,
    };
  });
  return { courses, changed };
}

/** Enough to estimate from: words, the menu, a photo — the meal's or a course's. */
export function isOutsideMealDescribed(
  m: Pick<OutsideMealView, "title" | "description" | "menuText" | "photoUrl" | "menuPhotoUrl"> & {
    courses?: Pick<OutsideMealCourseView, "text" | "photoUrl">[] | null;
  }
): boolean {
  return !!(
    m.title ||
    m.description ||
    m.menuText ||
    m.photoUrl ||
    m.menuPhotoUrl ||
    m.courses?.some((c) => c.text || c.photoUrl)
  );
}

/** The picture for a card: the plate, else the first course with one. */
export function outsideMealCoverPhoto(m: Pick<OutsideMealView, "photoUrl" | "courses">): string | null {
  return m.photoUrl ?? m.courses.find((c) => c.photoUrl)?.photoUrl ?? null;
}

/** Whether any calorie figure came off the menu (the meal's or a course's). */
export function usesMenuKcal(m: Pick<OutsideMealView, "menuKcal" | "courses">): boolean {
  return m.courses.length ? m.courses.some((c) => c.menuKcal) : !!m.menuKcal;
}

/** "Ribeye & chips at The Swan", or the kind when there's nothing else. */
export function outsideMealLabel(m: Pick<OutsideMealView, "title" | "place">, fallback: string): string {
  if (m.title && m.place) return `${m.title} at ${m.place}`;
  return m.title || m.place || fallback;
}

// Split free text into ingredient-like pieces: "Ribeye with chips, peas & gravy"
// → ["Ribeye", "chips", "peas", "gravy"]. Needed because the protein check
// skips any name mentioning a sauce, and a whole sentence nearly always does.
const SPLIT = /,|;|\n|\+|&|\/|\bwith\b|\band\b|\bor\b/i;

export function textFragments(...texts: (string | null | undefined)[]): string[] {
  return texts
    .flatMap((t) => (t ? t.split(SPLIT) : []))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * What the protein targets read for this meal. The AI's main ingredients once
 * it has looked; before that (or with no AI key) the eater's own words, so a
 * steak still counts towards red meat straight away.
 */
export function outsideMealIngredientNames(
  m: Pick<OutsideMealView, "mainIngredients" | "components" | "title" | "description" | "menuText"> & {
    courses?: Pick<OutsideMealCourseView, "text">[] | null;
  }
): string[] {
  if (m.mainIngredients?.length) return m.mainIngredients;
  return textFragments(
    ...(m.components ?? []),
    m.title,
    m.menuText,
    m.description,
    ...(m.courses ?? []).map((c) => c.text)
  );
}

/** A skipped meal wasn't eaten, so it doesn't count as a meal at all. */
export function countsAsMeal(m: Pick<OutsideMealView, "kind">): boolean {
  return m.kind !== "skipped";
}

export function outsideMealFacts(m: OutsideMealView): MealFacts {
  return {
    recipeId: m.id,
    calories: m.calories,
    saturatedFatG: m.saturatedFatG,
    fiberG: m.fiberG,
    ingredientNames: outsideMealIngredientNames(m),
  };
}
