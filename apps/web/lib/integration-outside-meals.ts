import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { MEAL_TYPES, OUTSIDE_MEAL_COURSES, OUTSIDE_MEAL_KINDS, OUTSIDE_MEAL_PORTIONS } from "@dishes/shared";
import {
  listOutsideMeals,
  MAX_COURSES,
  OutsideMealNotFoundError,
  OutsideMealValidationError,
  type UpdateOutsideMealInput,
} from "@/lib/services/outside-meals";
import type { OutsideMealView } from "@/lib/outside-meals";
import { matchDiners } from "@/lib/diner-brief";

/**
 * Meals the household isn't cooking from the plan — eaten out, takeaways, at
 * friends', skipped — as the integrations API shows them: what and where,
 * and the calories once estimated. Dates inclusive, YYYY-MM-DD.
 */
export async function outsideMealsJson(householdId: string, from: string, to: string) {
  const meals = await listOutsideMeals(householdId, { from, to });
  return meals.map((m) => ({
    id: m.id,
    date: m.date,
    dayOfWeek: (new Date(`${m.date}T00:00:00Z`).getUTCDay() + 6) % 7,
    mealType: m.mealType,
    kind: m.kind,
    title: m.title,
    place: m.place,
    cuisine: m.cuisine,
    calories: m.calories,
    /** "ai" = estimated, "manual" = typed in, "none" = not yet. */
    nutritionSource: m.nutritionSource,
    /** Empty for a single dish; `calories` above is the whole sitting. */
    courses: m.courses.map((c) => ({ course: c.course, name: c.name ?? c.text, calories: c.calories })),
  }));
}

// ── Writes (`write:outside_meals`) ──────────────────────────────────────────

/**
 * The integrations wire format for logging a meal out. The same fields as
 * `/api/v1/outside-meals`, adjusted for an AI assistant writing it: ratings
 * are 1–5 stars like the diner brief (stored 0–10), and a course's id is
 * optional — a new course gets one.
 */
const stars = z.number().min(0).max(5);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const figure = z.number().nonnegative().nullable();

const writeFields = {
  date,
  mealType: z.enum(MEAL_TYPES),
  kind: z.enum(OUTSIDE_MEAL_KINDS),
  title: z.string().max(200).nullable(),
  place: z.string().max(200).nullable(),
  cuisine: z.string().max(100).nullable(),
  description: z.string().max(4000).nullable(),
  menuText: z.string().max(4000).nullable(),
  portion: z.enum(OUTSIDE_MEAL_PORTIONS),
  menuKcal: z.number().int().positive().max(9999).nullable(),
  eatenBy: z.array(z.string()).nullable(),
  rating: stars.nullable(),
  memberRatings: z.array(z.object({ name: z.string().min(1), rating: stars })).nullable(),
  notes: z.string().max(4000).nullable(),
  nutrition: z
    .object({
      calories: figure,
      proteinG: figure,
      carbsG: figure,
      fatG: figure,
      saturatedFatG: figure,
      fiberG: figure,
      sugarG: figure,
      sodiumMg: figure,
    })
    .nullable(),
  courses: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "a UUID").optional(),
        course: z.enum(OUTSIDE_MEAL_COURSES),
        text: z.string().max(2000).nullable().optional(),
        menuKcal: z.number().int().positive().max(9999).nullable().optional(),
      })
    )
    .max(MAX_COURSES)
    .nullable(),
};

export const logOutsideMealSchema = z.object(writeFields).partial().required({ date: true });
export const editOutsideMealSchema = z
  .object(writeFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

export class UnknownEaterError extends Error {
  constructor(
    readonly unknown: string[],
    readonly known: string[]
  ) {
    super(`No household member called ${unknown.join(", ")}. Members: ${known.join(", ")}`);
    this.name = "UnknownEaterError";
  }
}

const toTen = (r: number) => Math.round(r * 2);

/**
 * The service's input from the wire: stars to 0–10, new courses given ids,
 * and names (who ate it, who rated it) matched to members' display names —
 * an unknown one throws `UnknownEaterError` rather than filing a rating under
 * a name nobody has.
 */
export function toOutsideMealInput(
  body: z.infer<typeof editOutsideMealSchema>,
  members: { id: string; displayName: string }[]
): UpdateOutsideMealInput {
  const names = (wanted: string[]) => {
    const { diners, unknown } = matchDiners(members, wanted);
    if (unknown.length) throw new UnknownEaterError(unknown, members.map((m) => m.displayName));
    return diners.map((d) => d.displayName);
  };

  const { rating, memberRatings, eatenBy, courses, ...rest } = body;
  return {
    ...rest,
    ...(rating !== undefined ? { rating: rating === null ? null : toTen(rating) } : {}),
    ...(memberRatings !== undefined
      ? {
          memberRatings:
            memberRatings === null
              ? null
              : memberRatings.map((r) => ({ name: names([r.name])[0]!, rating: toTen(r.rating) })),
        }
      : {}),
    ...(eatenBy !== undefined ? { eatenBy: eatenBy === null ? null : names(eatenBy) } : {}),
    ...(courses !== undefined
      ? { courses: courses === null ? null : courses.map((c) => ({ ...c, id: c.id ?? randomUUID() })) }
      : {}),
  };
}

const toStars = (r: number | null) => (r == null ? null : r / 2);

/** One meal out in full, as the integration writes return it. */
export function outsideMealDetailJson(m: OutsideMealView, origin: string) {
  return {
    id: m.id,
    date: m.date,
    mealType: m.mealType,
    kind: m.kind,
    title: m.title,
    place: m.place,
    cuisine: m.cuisine,
    description: m.description,
    menuText: m.menuText,
    portion: m.portion,
    menuKcal: m.menuKcal,
    eatenBy: m.eatenBy,
    /** The household's view: the average of everyone's stars. */
    rating: toStars(m.rating),
    memberRatings: m.memberRatings?.map((r) => ({ name: r.name, rating: r.rating / 2 })) ?? null,
    notes: m.notes,
    courses: m.courses.map((c) => ({
      id: c.id,
      course: c.course,
      text: c.text,
      name: c.name,
      menuKcal: c.menuKcal,
      calories: c.calories,
    })),
    /** "ai" = estimated (arrives a few seconds after a write), "manual" = typed in, "none" = not yet. */
    nutritionSource: m.nutritionSource,
    nutrition:
      m.nutritionSource === "none"
        ? null
        : {
            calories: m.calories,
            proteinG: m.proteinG,
            carbsG: m.carbsG,
            fatG: m.fatG,
            saturatedFatG: m.saturatedFatG,
            fiberG: m.fiberG,
            sugarG: m.sugarG,
            sodiumMg: m.sodiumMg,
          },
    hasPhoto: !!(m.photoUrl || m.menuPhotoUrl || m.courses.some((c) => c.photoUrl)),
    /** The meal's week on the planner. */
    url: `${origin}/meal-plan?week=${m.date}`,
  };
}

/** What a meal-out route answers for an error it understands; null for the rest. */
export function outsideMealErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (err instanceof UnknownEaterError) {
    return NextResponse.json({ error: err.message, members: err.known }, { status: 400 });
  }
  if (err instanceof OutsideMealValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
  if (err instanceof OutsideMealNotFoundError) return NextResponse.json({ error: "Meal not found" }, { status: 404 });
  return null;
}

/** Writes are filed under a person, so the token has to act as one. */
export function noActingMember(): NextResponse {
  return NextResponse.json(
    {
      error:
        "This token doesn't act as a household member. Create a token with \"Acts as\" set (Settings → Integrations) to log meals out.",
    },
    { status: 403 }
  );
}
