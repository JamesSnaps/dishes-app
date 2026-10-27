import { z } from "zod";
import { MEAL_TYPES, OUTSIDE_MEAL_COURSES, OUTSIDE_MEAL_KINDS, OUTSIDE_MEAL_PORTIONS } from "@dishes/shared";

/** Wire formats for /api/v1/outside-meals. Ratings are 0–10, half-star precision. */

const rating = z.number().min(0).max(10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const figure = z.number().nonnegative().nullable();

const nutrition = z.object({
  calories: figure,
  proteinG: figure,
  carbsG: figure,
  fatG: figure,
  saturatedFatG: figure,
  fiberG: figure,
  sugarG: figure,
  sodiumMg: figure,
});

/** A course; its photo goes up separately (`…/photo?slot=course&course=<id>`). */
const course = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "a UUID"),
  course: z.enum(OUTSIDE_MEAL_COURSES),
  text: z.string().max(2000).nullable().optional(),
  menuKcal: z.number().int().positive().max(9999).nullable().optional(),
  removePhoto: z.boolean().optional(),
});

const fields = {
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
  rating: rating.nullable(),
  memberRatings: z.array(z.object({ name: z.string().min(1), rating })).nullable(),
  notes: z.string().nullable(),
  /** Typed-in figures (marked manual); null hands the meal back to the estimator. */
  nutrition: nutrition.nullable(),
  /** Every course, or null/[] for one dish. Left out, the courses stay as they are. */
  courses: z.array(course).max(8).nullable(),
};

export const createOutsideMealSchema = z.object(fields).partial().required({ date: true });

export const updateOutsideMealSchema = z
  .object({ ...fields, removePhoto: z.boolean(), removeMenuPhoto: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

export const outsideMealRangeSchema = z.object({ from: date.optional(), to: date.optional() });

export const photoSlotSchema = z
  .object({ slot: z.enum(["plate", "menu", "course"]).default("plate"), course: z.string().optional() })
  .refine((v) => v.slot !== "course" || !!v.course, "A course photo needs ?course=<id>");
