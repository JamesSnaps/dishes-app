/**
 * Checks the meal-schedule rules in `lib/meal-timeline.ts` that cooking mode
 * leans on: one serve cue doing every dish's serving step, and finishing steps
 * (carving the lamb) never ahead of the cooking they finish.
 *
 * Usage (from apps/web): npx tsx scripts/check-meal-timeline.ts
 * Pure — no database or network.
 */

import assert from "node:assert/strict";
import {
  autoTimeline,
  isServingStep,
  reconcileTimeline,
  type MealTimeline,
  type TimelineDishInput,
} from "../lib/meal-timeline";

const step = (instruction: string, durationMinutes: number | null = null) => ({
  instruction,
  durationMinutes,
  timerLabel: null,
});

const lamb: TimelineDishInput = {
  recipeId: "lamb",
  title: "Slow-cooker lamb",
  role: "main",
  steps: [step("Season the lamb", 10), step("Slow cook on low", 480), step("Carve and serve")],
};
const potatoes: TimelineDishInput = {
  recipeId: "spuds",
  title: "Roast potatoes",
  role: "side",
  steps: [step("Parboil the potatoes", 10), step("Roast at 200°C", 45), step("Serve")],
};
const greens: TimelineDishInput = {
  recipeId: "greens",
  title: "Greens",
  role: "side",
  steps: [step("Steam the greens", 6), step("Garnish with lemon zest")],
};
const gravy: TimelineDishInput = {
  recipeId: "gravy",
  title: "Gravy",
  role: "sauce",
  steps: [step("Make the gravy", 15), step("Spoon the gravy over the lamb and serve")],
};
const meal = [lamb, potatoes, greens, gravy];

function serveOf(t: MealTimeline) {
  const serves = t.cues.filter((c) => c.id === "serve");
  assert.equal(serves.length, 1, "exactly one serve cue");
  return serves[0]!;
}
const cueFor = (t: MealTimeline, recipeId: string, stepIndex: number) =>
  t.cues.find((c) => c.recipeId === recipeId && c.stepIndex === stepIndex);
const lastSteps = meal.map((d) => ({ recipeId: d.recipeId, stepIndex: d.steps.length - 1 }));

const checks: [string, () => void][] = [
  [
    "serving steps are recognised, cooking ones aren't",
    () => {
      for (const s of ["Serve", "Serve with rice", "Carve and serve", "Carve the lamb and serve with gravy",
        "Garnish with parsley", "Plate up", "Spoon the sauce over the chicken and serve", "To serve, garnish with chives"]) {
        assert.ok(isServingStep(step(s)), s);
      }
      for (const s of ["Plate the fish and bake for 10 minutes", "Rest for 15 minutes, then carve and serve",
        "Season to taste", "Slice the onions", "Plate up, then grill for 2 minutes", "Garnish and return to the oven"]) {
        assert.ok(!isServingStep(step(s)), s);
      }
      assert.ok(!isServingStep(step("Serve", 30)), "a long step isn't just serving");
    },
  ],
  [
    "simple schedule: every dish's serving step is the one serve cue",
    () => {
      const t = autoTimeline(meal);
      const serve = serveOf(t);
      assert.equal(serve.offsetMinutes, 0);
      assert.deepEqual(serve.covers, lastSteps);
      for (const s of lastSteps) assert.equal(cueFor(t, s.recipeId, s.stepIndex), undefined);
      // The cooking before it still ends as dinner is served.
      assert.equal(cueFor(t, "lamb", 1)!.offsetMinutes, -480);
      assert.equal(cueFor(t, "greens", 0)!.offsetMinutes, -6);
    },
  ],
  [
    "AI schedule: separate serve cues per dish are folded into one",
    () => {
      const t = reconcileTimeline(
        [
          { offsetMinutes: -500, recipeId: "lamb", stepIndex: 0, text: "Season the lamb" },
          { offsetMinutes: -490, recipeId: "lamb", stepIndex: 1, text: "Lamb into the slow cooker" },
          { offsetMinutes: -45, recipeId: "lamb", stepIndex: 2, text: "Carve and serve" },
          { offsetMinutes: -60, recipeId: "spuds", stepIndex: 0, text: "Parboil" },
          { offsetMinutes: -50, recipeId: "spuds", stepIndex: 1, text: "Roast" },
          { offsetMinutes: -2, recipeId: "spuds", stepIndex: 2, text: "Serve" },
          { offsetMinutes: -8, recipeId: "greens", stepIndex: 0, text: "Steam" },
          {
            offsetMinutes: 0,
            recipeId: null,
            stepIndex: null,
            text: "Plate everything up",
            covers: [{ recipeId: "greens", stepIndex: 1 }, { recipeId: "gravy", stepIndex: 1 }],
          },
          { offsetMinutes: -20, recipeId: "gravy", stepIndex: 0, text: "Gravy" },
          { offsetMinutes: 0, recipeId: null, stepIndex: null, text: "Serve" },
        ],
        [],
        meal
      );
      const serve = serveOf(t);
      assert.deepEqual(serve.covers, lastSteps);
      assert.equal(t.cues.filter((c) => c.offsetMinutes === 0).length, 1, "nothing else at serving");
      assert.ok(!t.cues.some((c) => c.id.startsWith("combo:") || c.id.startsWith("note:")));
      assert.equal(t.cues.at(-1)!.id, "serve");
    },
  ],
  [
    "lamb: carving can't come before the slow cook ends",
    () => {
      const restAndCarve: TimelineDishInput = {
        ...lamb,
        steps: [lamb.steps[0]!, lamb.steps[1]!, step("Lift out, rest for 15 minutes, then carve and serve", 15)],
      };
      const t = reconcileTimeline(
        [
          { offsetMinutes: -500, recipeId: "lamb", stepIndex: 0, text: "Season" },
          { offsetMinutes: -490, recipeId: "lamb", stepIndex: 1, text: "Slow cook" },
          { offsetMinutes: -45, recipeId: "lamb", stepIndex: 2, text: "Rest, then carve" },
        ],
        [],
        [restAndCarve]
      );
      // The slow cook ends at −10: carving starts then, not 45 minutes before dinner.
      assert.equal(cueFor(t, "lamb", 2)!.offsetMinutes, -10);
      assert.equal(serveOf(t).covers, undefined);
    },
  ],
  [
    "a 'meanwhile' last step can still overlap",
    () => {
      const bread: TimelineDishInput = {
        recipeId: "soup",
        title: "Soup",
        role: "main",
        steps: [step("Simmer the soup", 30), step("Meanwhile, slice the bread", 5)],
      };
      const t = reconcileTimeline(
        [
          { offsetMinutes: -35, recipeId: "soup", stepIndex: 0, text: "Simmer" },
          { offsetMinutes: -20, recipeId: "soup", stepIndex: 1, text: "Slice the bread" },
        ],
        [],
        [bread]
      );
      assert.equal(cueFor(t, "soup", 1)!.offsetMinutes, -20);
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
