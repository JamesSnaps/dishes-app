/**
 * Meals not cooked from the library — eaten out, takeaways, at friends',
 * skipped — shared by the server actions (`app/actions/outside-meals.ts`) and
 * `app/api/v1/outside-meals`.
 *
 * Same rules as the other services: takes a household context, scopes every
 * query by householdId, never redirects or revalidates.
 *
 * Nutrition is estimated separately (`estimateOutsideMealNutrition`) because
 * it's an AI call: the web awaits it after saving, the v1 routes run it once
 * the reply has gone and the numbers arrive by sync.
 */

import OpenAI from "openai";
import sharp from "sharp";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  aiConfigurations,
  outsideMeals,
  type MemberRating,
  type OutsideMeal,
} from "@dishes/db/schema";
import {
  isOutsideMealCourseType,
  isOutsideMealKind,
  MEAL_TYPES,
  OUTSIDE_MEAL_PORTIONS,
  type MealType,
  type OutsideMealKind,
  type OutsideMealPortion,
} from "@dishes/shared";
import { decrypt } from "@/lib/crypto";
import { downloadFile, isStorageAvailable, keyFromUrl, uploadFile } from "@/lib/storage";
import { makeThumbnail } from "@/lib/thumbnail";
import { readOutsideMeal } from "@/lib/ai/outside-meal-nutrition";
import type { RecipeNutrition } from "@/lib/ai/recipe-generation";
import { assertRating, cleanMemberRatings, combineVoices, memberName } from "@/lib/services/cook-history";
import { ownRating } from "@/lib/cook-ratings";
import { refreshTasteProfile } from "@/lib/services/taste-profile";
import type { HouseholdContext } from "@/lib/session";
import {
  coursesFrom,
  isOutsideMealDescribed,
  mergeCourses,
  type OutsideMealCourseInput,
  type OutsideMealView,
} from "@/lib/outside-meals";

export type { OutsideMealCourseInput };

export class OutsideMealNotFoundError extends Error {
  constructor() {
    super("Meal not found");
    this.name = "OutsideMealNotFoundError";
  }
}

export class OutsideMealValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutsideMealValidationError";
  }
}

// --- Types ------------------------------------------------------------------

export type OutsideMealInput = {
  /** YYYY-MM-DD */
  date: string;
  mealType?: MealType;
  kind?: OutsideMealKind;
  title?: string | null;
  place?: string | null;
  cuisine?: string | null;
  description?: string | null;
  menuText?: string | null;
  portion?: OutsideMealPortion;
  menuKcal?: number | null;
  eatenBy?: string[] | null;
  /** The saving member's own rating, 0–10; others' go in memberRatings. */
  rating?: number | null;
  memberRatings?: MemberRating[] | null;
  notes?: string | null;
  /** Typed-in figures: marks the nutrition manual, so no estimate replaces it. */
  nutrition?: RecipeNutrition | null;
  /**
   * The courses, all of them, in any order (they're shown in eating order).
   * Null or [] makes it one dish again; absent leaves them as they are.
   */
  courses?: OutsideMealCourseInput[] | null;
};


export type UpdateOutsideMealInput = Partial<OutsideMealInput> & {
  removePhoto?: boolean;
  removeMenuPhoto?: boolean;
};

/** The plate, the menu, or one course's plate (`courseId`). */
export type PhotoSlot = "plate" | "menu" | "course";

export const MAX_COURSES = 8;
/** Course photos the estimator looks at, in eating order; the rest go by their words. */
const MAX_COURSE_PHOTOS = 6;

// --- Helpers ----------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(date: string): void {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new OutsideMealValidationError("date must be YYYY-MM-DD");
  }
}

function text(v: string | null | undefined, max?: number): string | null {
  const t = v?.trim();
  if (!t) return null;
  return max ? t.slice(0, max) : t;
}

const num = (v: string | number | null) => (v == null ? null : Number(v));
const decimal = (v: number | null | undefined) => (v == null ? null : String(v));

export function toView(row: OutsideMeal): OutsideMealView {
  return {
    id: row.id,
    date: row.date,
    mealType: row.mealType,
    kind: isOutsideMealKind(row.kind) ? row.kind : "eat_out",
    title: row.title,
    place: row.place,
    cuisine: row.cuisine,
    description: row.description,
    menuText: row.menuText,
    portion: (OUTSIDE_MEAL_PORTIONS as readonly string[]).includes(row.portion)
      ? (row.portion as OutsideMealPortion)
      : "typical",
    components: row.components ?? null,
    courses: coursesFrom(row.courses),
    mainIngredients: row.mainIngredients ?? null,
    menuKcal: row.menuKcal,
    calories: row.calories,
    proteinG: num(row.proteinG),
    carbsG: num(row.carbsG),
    fatG: num(row.fatG),
    saturatedFatG: num(row.saturatedFatG),
    fiberG: num(row.fiberG),
    sugarG: num(row.sugarG),
    sodiumMg: num(row.sodiumMg),
    nutritionSource: row.nutritionSource,
    eatenBy: row.eatenBy ?? null,
    rating: num(row.rating),
    memberRatings: row.memberRatings ?? null,
    notes: row.notes,
    photoUrl: row.photoUrl,
    menuPhotoUrl: row.menuPhotoUrl,
  };
}

function nutritionColumns(n: RecipeNutrition | null, source: "ai" | "manual" | "none") {
  return {
    calories: n?.calories == null ? null : Math.round(n.calories),
    proteinG: decimal(n?.proteinG),
    carbsG: decimal(n?.carbsG),
    fatG: decimal(n?.fatG),
    saturatedFatG: decimal(n?.saturatedFatG),
    fiberG: decimal(n?.fiberG),
    sugarG: decimal(n?.sugarG),
    sodiumMg: decimal(n?.sodiumMg),
    nutritionSource: source,
  };
}

function assertFields(input: Partial<OutsideMealInput>): void {
  if (input.date !== undefined) assertDate(input.date);
  if (input.mealType !== undefined && !(MEAL_TYPES as readonly string[]).includes(input.mealType)) {
    throw new OutsideMealValidationError("Unknown meal type");
  }
  if (input.kind !== undefined && !isOutsideMealKind(input.kind)) {
    throw new OutsideMealValidationError("Unknown kind");
  }
  if (input.portion !== undefined && !(OUTSIDE_MEAL_PORTIONS as readonly string[]).includes(input.portion)) {
    throw new OutsideMealValidationError("Unknown portion");
  }
  if (input.menuKcal != null && !(Number.isInteger(input.menuKcal) && input.menuKcal > 0 && input.menuKcal < 10000)) {
    throw new OutsideMealValidationError("menuKcal must be a whole number of kcal");
  }
  assertRating(input.rating);
  if (input.courses) assertCourses(input.courses);
}

const COURSE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function assertCourses(courses: OutsideMealCourseInput[]): void {
  if (courses.length > MAX_COURSES) throw new OutsideMealValidationError(`At most ${MAX_COURSES} courses.`);
  const ids = new Set<string>();
  for (const c of courses) {
    if (typeof c.id !== "string" || !COURSE_ID_RE.test(c.id) || ids.has(c.id)) {
      throw new OutsideMealValidationError("Each course needs its own id.");
    }
    ids.add(c.id);
    if (!isOutsideMealCourseType(c.course)) throw new OutsideMealValidationError("Unknown course");
    if (c.menuKcal != null && !(Number.isInteger(c.menuKcal) && c.menuKcal > 0 && c.menuKcal < 10000)) {
      throw new OutsideMealValidationError("A course's menu calories must be a whole number of kcal");
    }
  }
}


/** The fields an estimate reads: changing any of them makes it stale. */
const ESTIMATE_INPUTS = ["kind", "title", "place", "cuisine", "description", "menuText", "portion", "menuKcal"] as const;

async function loadOwned(ctx: Pick<HouseholdContext, "householdId">, id: string): Promise<OutsideMeal> {
  const [row] = await db
    .select()
    .from(outsideMeals)
    .where(and(eq(outsideMeals.id, id), eq(outsideMeals.householdId, ctx.householdId)))
    .limit(1);
  if (!row) throw new OutsideMealNotFoundError();
  return row;
}

// --- Writes -----------------------------------------------------------------

export async function createOutsideMeal(
  ctx: HouseholdContext,
  input: OutsideMealInput
): Promise<OutsideMealView> {
  assertFields(input);
  const voices = combineVoices(await memberName(ctx), input.rating, cleanMemberRatings(input.memberRatings));

  const [row] = await db
    .insert(outsideMeals)
    .values({
      householdId: ctx.householdId,
      createdById: ctx.memberId,
      date: input.date,
      mealType: input.mealType ?? "dinner",
      kind: input.kind ?? "eat_out",
      title: text(input.title, 200),
      place: text(input.place, 200),
      cuisine: text(input.cuisine, 100),
      description: text(input.description),
      menuText: text(input.menuText),
      portion: input.portion ?? "typical",
      menuKcal: input.menuKcal ?? null,
      eatenBy: input.eatenBy?.length ? input.eatenBy : null,
      ...voices,
      notes: text(input.notes),
      courses: mergeCourses(null, input.courses ?? null).courses,
      ...(input.nutrition ? nutritionColumns(input.nutrition, "manual") : {}),
    })
    .returning();

  if (voices.rating != null) void refreshTasteProfile(ctx.householdId);
  return toView(row!);
}

/**
 * Partial update. `staleEstimate` says the meal's description changed under
 * an AI estimate, so the caller should estimate it again (typed-in figures
 * are never replaced).
 */
export async function updateOutsideMeal(
  ctx: HouseholdContext,
  id: string,
  input: UpdateOutsideMealInput
): Promise<{ meal: OutsideMealView; staleEstimate: boolean }> {
  assertFields(input);
  const existing = await loadOwned(ctx, id);

  let voices: ReturnType<typeof combineVoices> | undefined;
  if (input.rating !== undefined || input.memberRatings !== undefined) {
    const name = await memberName(ctx);
    const stored = ownRating(
      { rating: num(existing.rating), memberRatings: existing.memberRatings ?? null },
      name
    );
    voices = combineVoices(
      name,
      input.rating !== undefined ? input.rating : stored.own,
      input.memberRatings !== undefined ? cleanMemberRatings(input.memberRatings) : stored.others
    );
  }

  const merged = input.courses !== undefined ? mergeCourses(existing.courses, input.courses) : null;

  const set: Partial<typeof outsideMeals.$inferInsert> = {
    ...(merged ? { courses: merged.courses } : {}),
    ...(input.date !== undefined ? { date: input.date } : {}),
    ...(input.mealType !== undefined ? { mealType: input.mealType } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.title !== undefined ? { title: text(input.title, 200) } : {}),
    ...(input.place !== undefined ? { place: text(input.place, 200) } : {}),
    ...(input.cuisine !== undefined ? { cuisine: text(input.cuisine, 100) } : {}),
    ...(input.description !== undefined ? { description: text(input.description) } : {}),
    ...(input.menuText !== undefined ? { menuText: text(input.menuText) } : {}),
    ...(input.portion !== undefined ? { portion: input.portion } : {}),
    ...(input.menuKcal !== undefined ? { menuKcal: input.menuKcal } : {}),
    ...(input.eatenBy !== undefined ? { eatenBy: input.eatenBy?.length ? input.eatenBy : null } : {}),
    ...(voices ?? {}),
    ...(input.notes !== undefined ? { notes: text(input.notes) } : {}),
    ...(input.removePhoto ? { photoUrl: null } : {}),
    ...(input.removeMenuPhoto ? { menuPhotoUrl: null } : {}),
  };

  // Typed-in figures win; clearing them hands the meal back to the estimator.
  if (input.nutrition !== undefined) {
    Object.assign(set, input.nutrition ? nutritionColumns(input.nutrition, "manual") : nutritionColumns(null, "none"));
  }

  const changed = ESTIMATE_INPUTS.some((k) => {
    const v = set[k];
    return v !== undefined && v !== existing[k];
  }) || !!input.removePhoto || !!input.removeMenuPhoto || !!merged?.changed;
  const source = (set.nutritionSource ?? existing.nutritionSource) as OutsideMeal["nutritionSource"];
  const staleEstimate = source !== "manual" && (changed || input.nutrition === null);

  const [row] = Object.keys(set).length
    ? await db
        .update(outsideMeals)
        .set(set)
        .where(and(eq(outsideMeals.id, id), eq(outsideMeals.householdId, ctx.householdId)))
        .returning()
    : [existing];

  if (voices) void refreshTasteProfile(ctx.householdId);
  return { meal: toView(row!), staleEstimate };
}

export async function deleteOutsideMeal(ctx: HouseholdContext, id: string): Promise<void> {
  const existing = await loadOwned(ctx, id);
  await db
    .delete(outsideMeals)
    .where(and(eq(outsideMeals.id, id), eq(outsideMeals.householdId, ctx.householdId)));
  if (existing.rating != null) void refreshTasteProfile(ctx.householdId);
}

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

/** A photo of the plate or of the menu; the menu one is read by the estimator. */
export async function setOutsideMealPhoto(
  ctx: HouseholdContext,
  id: string,
  slot: PhotoSlot,
  raw: Buffer,
  contentType: string,
  courseId?: string
): Promise<{ url: string }> {
  if (!isStorageAvailable()) throw new OutsideMealValidationError("Storage not configured.");
  if (!PHOTO_TYPES.includes(contentType)) {
    throw new OutsideMealValidationError("Only JPEG, PNG, and WebP images are allowed.");
  }
  if (raw.byteLength > PHOTO_MAX_BYTES) throw new OutsideMealValidationError("Photo must be under 15 MB.");
  const row = await loadOwned(ctx, id);
  if (slot === "course" && !row.courses?.some((c) => c.id === courseId)) {
    throw new OutsideMealValidationError("That course isn't part of this meal — save it first.");
  }

  const resized = await sharp(raw)
    .rotate() // auto-rotate from EXIF orientation, then strip the tag
    .resize(1600, null, { withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  const base = `households/${ctx.householdId}/outside-meals/${id}`;
  const name = slot === "menu" ? "menu" : slot === "course" ? `course-${courseId}` : "dish";
  // Each upload gets its own key so a cached old photo can't stand in for it.
  const stamp = Date.now().toString(36);
  const [url] = await Promise.all([
    uploadFile(`${base}/${name}-${stamp}.jpg`, resized, "image/jpeg"),
    slot !== "menu"
      ? makeThumbnail(raw)
          .then((thumb) => uploadFile(`${base}/${name}-${stamp}_thumb.jpg`, thumb, "image/jpeg"))
          .catch(() => null)
      : null,
  ]);

  if (slot === "course") {
    // Re-read: the courses may have been edited while the photo uploaded.
    const now = await loadOwned(ctx, id);
    const courses = (now.courses ?? []).map((c) =>
      c.id === courseId ? { ...c, photoUrl: url, name: null, components: null, calories: null } : c
    );
    await db
      .update(outsideMeals)
      .set({ courses })
      .where(and(eq(outsideMeals.id, id), eq(outsideMeals.householdId, ctx.householdId)));
  } else {
    await db
      .update(outsideMeals)
      .set(slot === "menu" ? { menuPhotoUrl: url } : { photoUrl: url })
      .where(and(eq(outsideMeals.id, id), eq(outsideMeals.householdId, ctx.householdId)));
  }

  return { url };
}

// --- Nutrition estimate -----------------------------------------------------

/** The household's AI client and model, or null with no key set. */
export async function aiClientFor(householdId: string): Promise<{ client: OpenAI; model: string } | null> {
  const [config] = await db
    .select({ encryptedApiKey: aiConfigurations.encryptedApiKey, model: aiConfigurations.model })
    .from(aiConfigurations)
    .where(eq(aiConfigurations.householdId, householdId))
    .limit(1);
  if (!config) return null;
  return {
    // Native fetch, as everywhere else: node-fetch breaks on Node 22.23+.
    client: new OpenAI({ apiKey: decrypt(config.encryptedApiKey), fetch: globalThis.fetch }),
    model: config.model,
  };
}

/** A stored photo as a small `data:` URL for the model, or null if unreadable. */
async function photoForModel(url: string | null): Promise<string | null> {
  const key = url ? keyFromUrl(url) : null;
  if (!key || !isStorageAvailable()) return null;
  try {
    const small = await sharp(await downloadFile(key))
      .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${small.toString("base64")}`;
  } catch (err) {
    console.warn(`[outside-meals] couldn't read photo ${key}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function aiMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/api key|401/i.test(msg)) return "The AI key was rejected — check Settings → AI.";
  if (/429|quota|rate/i.test(msg)) return "The AI is rate limited right now. Try again shortly.";
  return "The AI couldn't estimate this meal. Try again, or add more detail.";
}

/**
 * Ask the household's AI what was on the plate and what it came to, and save
 * it. Fills in the title, cuisine and main ingredients only where the eater
 * left them blank. Typed-in figures are never replaced; a skipped meal has
 * nothing to estimate.
 */
export async function estimateOutsideMealNutrition(
  ctx: HouseholdContext,
  id: string
): Promise<OutsideMealView> {
  const row = await loadOwned(ctx, id);
  const meal = toView(row);
  if (meal.nutritionSource === "manual") return meal;
  if (meal.kind === "skipped") throw new OutsideMealValidationError("A skipped meal has nothing to estimate.");
  if (!isOutsideMealDescribed(meal)) {
    throw new OutsideMealValidationError("Describe the meal, or add a photo of it or the menu, first.");
  }

  const ai = await aiClientFor(ctx.householdId);
  if (!ai) throw new OutsideMealValidationError("AI isn't set up — add a key in Settings → AI.");

  const withPhotos = new Set(meal.courses.filter((c) => c.photoUrl).slice(0, MAX_COURSE_PHOTOS).map((c) => c.id));
  const [platePhoto, menuPhoto, ...coursePhotos] = await Promise.all([
    photoForModel(meal.photoUrl),
    photoForModel(meal.menuPhotoUrl),
    ...meal.courses.map((c) => (withPhotos.has(c.id) ? photoForModel(c.photoUrl) : null)),
  ]);

  let reading;
  try {
    reading = await readOutsideMeal(ai.client, ai.model, {
      kind: meal.kind,
      title: meal.title,
      place: meal.place,
      cuisine: meal.cuisine,
      description: meal.description,
      menuText: meal.menuText,
      portion: meal.portion,
      menuKcal: meal.menuKcal,
      platePhoto,
      menuPhoto,
      courses: meal.courses.map((c, i) => ({
        id: c.id,
        course: c.course,
        text: c.text,
        menuKcal: c.menuKcal,
        photo: coursePhotos[i] ?? null,
      })),
    });
  } catch (err) {
    console.error(`[outside-meals] estimate failed meal=${id}:`, err instanceof Error ? err.message : err);
    throw new OutsideMealValidationError(aiMessage(err));
  }

  const [updated] = await db
    .update(outsideMeals)
    .set({
      ...nutritionColumns(reading.nutrition, "ai"),
      title: meal.title ?? (reading.title ? reading.title.slice(0, 200) : null),
      cuisine: meal.cuisine ?? (reading.cuisine ? reading.cuisine.slice(0, 100) : null),
      components: reading.components.length ? reading.components : null,
      mainIngredients: reading.mainIngredients.length ? reading.mainIngredients : null,
      ...(row.courses?.length
        ? {
            courses: row.courses.map((c) => {
              const read = reading.courses.find((r) => r.id === c.id);
              return read
                ? {
                    ...c,
                    name: read.name ? read.name.slice(0, 200) : null,
                    components: read.components.length ? read.components : null,
                    calories: read.nutrition.calories,
                  }
                : c;
            }),
          }
        : {}),
    })
    // Re-check the source: a figure typed in while the AI was thinking wins.
    .where(
      and(
        eq(outsideMeals.id, id),
        eq(outsideMeals.householdId, ctx.householdId),
        eq(outsideMeals.nutritionSource, row.nutritionSource)
      )
    )
    .returning();

  return updated ? toView(updated) : toView(await loadOwned(ctx, id));
}

// --- Reads ------------------------------------------------------------------

export async function getOutsideMeal(
  ctx: Pick<HouseholdContext, "householdId">,
  id: string
): Promise<OutsideMealView> {
  return toView(await loadOwned(ctx, id));
}

/** Every outside meal from `from` to `to` inclusive (YYYY-MM-DD), oldest first. */
export async function listOutsideMeals(
  householdId: string,
  range: { from?: string; to?: string } = {}
): Promise<OutsideMealView[]> {
  if (range.from) assertDate(range.from);
  if (range.to) assertDate(range.to);
  const rows = await db
    .select()
    .from(outsideMeals)
    .where(
      and(
        eq(outsideMeals.householdId, householdId),
        range.from ? gte(outsideMeals.date, range.from) : undefined,
        range.to ? lte(outsideMeals.date, range.to) : undefined
      )
    )
    .orderBy(asc(outsideMeals.date), asc(outsideMeals.createdAt));
  return rows.map(toView);
}

/** The seven days of a planner week (Monday first). */
export function weekRange(weekStartDate: string): { from: string; to: string } {
  assertDate(weekStartDate);
  const d = new Date(`${weekStartDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return { from: weekStartDate, to: d.toISOString().slice(0, 10) };
}
