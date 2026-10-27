/**
 * Checks the rules meals eaten out lean on: the menu's calorie figure winning
 * over the AI's (and everything else scaling with it), the protein targets
 * reading a meal before the AI has looked at it, and a synced row becoming a
 * meal without anything odd getting through.
 *
 * Usage (from apps/web): npx tsx scripts/check-outside-meals.ts
 * Pure — no database or network.
 */

import assert from "node:assert/strict";
import { anchorToMenuKcal, sumNutrition } from "../lib/ai/outside-meal-nutrition";
import {
  coursesFrom,
  countsAsMeal,
  isOutsideMealDescribed,
  mergeCourses,
  outsideMealCoverPhoto,
  outsideMealFacts,
  outsideMealFromRecord,
  outsideMealIngredientNames,
  textFragments,
  type OutsideMealView,
} from "../lib/outside-meals";
import { proteinsOf, summariseMeals } from "../lib/meal-stats";

const estimate = {
  calories: 900,
  proteinG: 50,
  carbsG: 60,
  fatG: 45,
  saturatedFatG: 20,
  fiberG: 6,
  sugarG: 8,
  sodiumMg: 1800,
};

function meal(patch: Partial<OutsideMealView>): OutsideMealView {
  return {
    id: "m1",
    date: "2026-10-23",
    mealType: "dinner",
    kind: "eat_out",
    title: null,
    place: null,
    cuisine: null,
    description: null,
    menuText: null,
    portion: "typical",
    components: null,
    courses: [],
    mainIngredients: null,
    menuKcal: null,
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    saturatedFatG: null,
    fiberG: null,
    sugarG: null,
    sodiumMg: null,
    nutritionSource: "none",
    eatenBy: null,
    rating: null,
    memberRatings: null,
    notes: null,
    photoUrl: null,
    menuPhotoUrl: null,
    ...patch,
  };
}

const checks: [string, () => void][] = [
  [
    "the menu's kcal is used as given and the rest scales with it",
    () => {
      const n = anchorToMenuKcal(estimate, 1200);
      assert.equal(n.calories, 1200);
      assert.equal(n.saturatedFatG, 26.7); // 20 × 1200/900
      assert.equal(n.sodiumMg, 2400);
      assert.equal(n.fiberG, 8);
    },
  ],
  [
    "without a menu figure the estimate stands, rounded",
    () => {
      const n = anchorToMenuKcal({ ...estimate, calories: 912.4, fatG: 45.06 }, null);
      assert.equal(n.calories, 912);
      assert.equal(n.fatG, 45.1);
    },
  ],
  [
    "nonsense from the model becomes null, never a figure",
    () => {
      const n = anchorToMenuKcal({ ...estimate, sugarG: -3, sodiumMg: Number.NaN }, null);
      assert.equal(n.sugarG, null);
      assert.equal(n.sodiumMg, null);
      // and a zero-calorie estimate can't be scaled to the menu
      assert.equal(anchorToMenuKcal({ ...estimate, calories: 0 }, 800).calories, 0);
    },
  ],
  [
    "free text splits into ingredient-like pieces",
    () => {
      assert.deepEqual(textFragments("Steak with chips, peas & peppercorn sauce", null), [
        "Steak",
        "chips",
        "peas",
        "peppercorn sauce",
      ]);
    },
  ],
  [
    "a steak described in words counts as red meat before any AI",
    () => {
      // Whole, the sentence mentions a sauce, which the protein check skips.
      assert.equal(proteinsOf(["Steak with peppercorn sauce"]).size, 0);
      const names = outsideMealIngredientNames(meal({ title: "Steak with peppercorn sauce" }));
      assert.deepEqual([...proteinsOf(names)], ["redMeat"]);
    },
  ],
  [
    "menu words for red meat count; look-alikes don't",
    () => {
      const kinds = (text: string) => [...proteinsOf(outsideMealIngredientNames(meal({ title: text })))];
      assert.deepEqual(kinds("Ribeye with peppercorn sauce"), ["redMeat"]);
      assert.deepEqual(kinds("Smash burger & fries"), ["redMeat"]);
      assert.deepEqual(kinds("Lamb kofta, flatbread"), ["redMeat"]);
      assert.deepEqual(kinds("Chicken burger"), ["poultry"]);
      assert.deepEqual(kinds("Veggie burger"), []);
      assert.deepEqual(kinds("Cauliflower steak"), []);
      assert.deepEqual(kinds("Lentil bolognese"), ["pulses"]);
      // A recipe's ingredient list is read the same way.
      assert.deepEqual([...proteinsOf(["brioche burger buns"])], []);
    },
  ],
  [
    "the AI's main ingredients win over the eater's words",
    () => {
      const names = outsideMealIngredientNames(
        meal({ title: "Surf and turf", mainIngredients: ["beef sirloin steak", "king prawns"] })
      );
      assert.deepEqual([...proteinsOf(names)].sort(), ["otherFish", "redMeat"]);
    },
  ],
  [
    "a skipped meal isn't a meal; one eaten out counts in the weekly summary",
    () => {
      assert.equal(countsAsMeal(meal({ kind: "skipped" })), false);
      const eaten = meal({ title: "Salmon teriyaki", calories: 700, saturatedFatG: 3, fiberG: 4 });
      const s = summariseMeals([outsideMealFacts(eaten)]);
      assert.equal(s.meals, 1);
      assert.equal(s.heartHealthy, 1);
      assert.equal(s.proteins.oilyFish, 1);
    },
  ],
  [
    "a synced row reads as a meal: decimals as numbers, unknowns defaulted",
    () => {
      const m = outsideMealFromRecord({
        id: "x",
        date: "2026-10-23",
        mealType: "supper",
        kind: "takeaway",
        portion: "huge",
        saturatedFatG: "12.5",
        calories: 980,
        rating: "8.0",
        mainIngredients: ["chicken thighs", 4],
        memberRatings: [{ name: "Sam", rating: 6 }, { name: 1 }],
        nutritionSource: "ai",
      });
      assert.ok(m);
      assert.equal(m.mealType, "dinner");
      assert.equal(m.kind, "takeaway");
      assert.equal(m.portion, "typical");
      assert.equal(m.saturatedFatG, 12.5);
      assert.equal(m.rating, 8);
      assert.deepEqual(m.mainIngredients, ["chicken thighs"]);
      assert.deepEqual(m.memberRatings, [{ name: "Sam", rating: 6 }]);
      assert.equal(outsideMealFromRecord({ id: "y" }), null);
    },
  ],
  [
    "stored courses come back in eating order, junk dropped",
    () => {
      const cs = coursesFrom([
        { id: "d", course: "dessert", text: "Sticky toffee pudding" },
        { id: "x", course: "pudding" },
        { id: "m", course: "main", text: "Ribeye", menuKcal: 980, calories: "lots" },
        { course: "starter" },
        { id: "s", course: "starter", text: "  ", photoUrl: "https://x/s.jpg" },
      ]);
      assert.deepEqual(cs.map((c) => c.id), ["s", "m", "d"]);
      assert.equal(cs[0]!.text, null);
      assert.equal(cs[1]!.menuKcal, 980);
      assert.equal(cs[1]!.calories, null);
      assert.deepEqual(coursesFrom("nope"), []);
    },
  ],
  [
    "an unchanged course keeps its photo and estimate; a changed one loses the estimate",
    () => {
      const stored = [
        { id: "s", course: "starter", text: "Squid", menuKcal: null, photoUrl: "https://x/s.jpg", name: "Salt & pepper squid", components: ["squid"], calories: 420 },
        { id: "m", course: "main", text: "Ribeye", menuKcal: 980, photoUrl: null, name: "Ribeye & chips", components: ["ribeye"], calories: 980 },
      ];
      const same = mergeCourses(stored, [
        { id: "m", course: "main", text: "Ribeye", menuKcal: 980 },
        { id: "s", course: "starter", text: " Squid " },
      ]);
      assert.equal(same.changed, false);
      assert.equal(same.courses?.find((c) => c.id === "s")?.photoUrl, "https://x/s.jpg");
      assert.equal(same.courses?.find((c) => c.id === "m")?.calories, 980);

      const edited = mergeCourses(stored, [
        { id: "s", course: "starter", text: "Squid", removePhoto: true },
        { id: "m", course: "main", text: "Sirloin", menuKcal: 980 },
        { id: "d", course: "dessert", text: "Brownie" },
      ]);
      assert.equal(edited.changed, true);
      const [s, m, d] = edited.courses!;
      assert.equal(s!.photoUrl, null);
      assert.equal(s!.calories, null);
      assert.equal(m!.name, null);
      assert.equal(d!.photoUrl, null);

      assert.deepEqual(mergeCourses(stored, null), { courses: null, changed: true });
      assert.deepEqual(mergeCourses(null, []), { courses: null, changed: false });
    },
  ],
  [
    "a sitting's figures are its courses' (each anchored to its own menu kcal) plus anything else",
    () => {
      const starter = anchorToMenuKcal({ ...estimate, calories: 400 }, null);
      const main = anchorToMenuKcal(estimate, 1200);
      const bread = anchorToMenuKcal(
        { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, saturatedFatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0 },
        null
      );
      const total = sumNutrition([starter, main, bread]);
      assert.equal(total.calories, 1600);
      assert.equal(total.proteinG, 50 + 66.7);
      const none = sumNutrition([anchorToMenuKcal({ ...estimate, fiberG: null }, null)]);
      assert.equal(none.fiberG, null);
    },
  ],
  [
    "a course alone describes a meal, and its words count for the protein targets",
    () => {
      const m = meal({
        courses: coursesFrom([
          { id: "s", course: "starter", photoUrl: "https://x/s.jpg" },
          { id: "m", course: "main", text: "Grilled salmon with greens" },
        ]),
      });
      assert.equal(isOutsideMealDescribed(m), true);
      assert.equal(isOutsideMealDescribed(meal({})), false);
      assert.equal(outsideMealCoverPhoto(m), "https://x/s.jpg");
      assert.ok(proteinsOf(outsideMealIngredientNames(m)).has("oilyFish"));
    },
  ],
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failed++;
    console.error(`✘ ${name}\n  ${err instanceof Error ? err.message : err}`);
  }
}
if (failed) process.exit(1);
