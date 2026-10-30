/**
 * Checks what the generation wait screens are told is true: the week
 * planner's facts say only what the data says (and nothing when there's
 * nothing to say), its photos prefer the recipes it might pick and never
 * repeat; a recipe being written reports the part it's on from a partial
 * parse; and a plain-JSON answer streamed through the partial parser still
 * hands on each finished element once.
 *
 * Usage (from apps/web): npx tsx scripts/check-generation-progress.ts
 * Pure — no database or network.
 */

import assert from "node:assert/strict";
import { partialParse } from "openai/_vendor/partial-json-parser/parser";
import { joinNames, mealsPhrase, planFacts, planPhotos, PLAN_PHOTO_COUNT, type PlanFactsInput } from "../lib/ai/plan-progress";
import { recipeProgressOf } from "../lib/ai/recipe-generation";
import { completedItems } from "../lib/ai/stream-structured";

// ── planFacts ─────────────────────────────────────────────────────────────────

const quiet: PlanFactsInput = {
  scanned: 0,
  eligible: 0,
  favouritesOnly: false,
  resting: 0,
  restingWeeks: 3,
  disliked: 0,
  eaters: [],
  heartHealthy: false,
  alreadyPlanned: 0,
  notCookingDays: [],
  keeping: 0,
  month: null,
  mealTypes: ["dinner", "dinner", "dinner"],
};
assert.deepEqual(planFacts(quiet), ["Choosing 3 dinners"], "an empty library and no filters: only what it's doing");

const busy = planFacts({
  ...quiet,
  scanned: 142,
  eligible: 31,
  favouritesOnly: true,
  resting: 9,
  disliked: 1,
  eaters: ["Sam", "Alex", "Jo"],
  heartHealthy: true,
  alreadyPlanned: 2,
  notCookingDays: ["Friday", "Friday", "Saturday"],
  keeping: 1,
  month: "November",
  mealTypes: ["lunch", "lunch"],
});
assert.deepEqual(busy, [
  "Looking through 142 of your recipes",
  "Choosing from 31 favourites",
  "Resting 9 dishes you’ve had in the last 3 weeks",
  "Leaving out 1 dish rated 2★ or less",
  "Cooking for Sam, Alex and Jo",
  "Keeping the week heart-healthy",
  "Planning around 2 meals already in the week",
  "Not cooking on Friday and Saturday",
  "Balancing against the 1 meal you’re keeping",
  "Leaning into November produce",
  "Choosing 2 lunches",
]);
assert.ok(planFacts({ ...quiet, scanned: 1 }).includes("Looking through your one recipe"));
assert.ok(
  planFacts({ ...quiet, resting: 4, restingWeeks: 1 }).includes("Resting 4 dishes you’ve had in the last week"),
  "a relaxed cooldown says the week it actually used"
);
assert.ok(!planFacts({ ...quiet, resting: 4, restingWeeks: 0 }).some((f) => f.startsWith("Resting")), "no cooldown, nothing resting");
assert.ok(planFacts({ ...quiet, favouritesOnly: true }).includes("No favourites to choose from, so all new ideas"));

assert.equal(joinNames([]), "");
assert.equal(joinNames(["Sam"]), "Sam");
assert.equal(joinNames(["Sam", "Alex"]), "Sam and Alex");
assert.equal(mealsPhrase(["dinner"]), "dinner");
assert.equal(mealsPhrase(["lunch", "lunch"]), "lunches");
assert.equal(mealsPhrase(["breakfast", "dinner"]), "meals");
assert.equal(mealsPhrase(["snack", "snack"]), "snacks");

// ── planPhotos ────────────────────────────────────────────────────────────────

const photo = (thumb: string | null, image: string | null = null) => ({ thumbnailUrl: thumb, imageUrl: image });
assert.deepEqual(
  planPhotos([photo("/t/1.jpg", "/i/1.jpg"), photo(null, "/i/2.jpg"), photo(null)], [photo("/t/1.jpg"), photo("/t/3.jpg")]),
  ["/t/1.jpg", "/i/2.jpg", "/t/3.jpg"],
  "thumbnails first, the full photo when there's no thumbnail, topped up from the library, no repeats"
);
const many = Array.from({ length: 40 }, (_, i) => photo(`/t/${i}.jpg`));
assert.equal(planPhotos(many, many).length, PLAN_PHOTO_COUNT, "capped");
assert.deepEqual(planPhotos([], []), [], "no photos: the screen falls back to plates");

// ── recipeProgressOf ──────────────────────────────────────────────────────────

assert.equal(recipeProgressOf(null), null);
assert.equal(recipeProgressOf({ title: "Orzo", description: "Lemony" }), null, "nothing to show before the ingredients");
assert.deepEqual(
  recipeProgressOf({ title: "Orzo", ingredients: [{ ingredientName: "orzo" }, { ingredientName: " feta " }, { ingredientName: "" }, {}] }),
  { stage: "ingredients", ingredients: ["orzo", "feta"], steps: 0 },
  "names as written, half-written ones skipped"
);
assert.deepEqual(
  recipeProgressOf({ ingredients: [{ ingredientName: "orzo" }], steps: [{ instruction: "Boil" }, {}] }),
  { stage: "method", ingredients: ["orzo"], steps: 2 }
);
assert.deepEqual(recipeProgressOf({ ingredients: [], steps: [{}], nutrition: {} })?.stage, "nutrition");

// ── completedItems over partialParse (plain json_object answers) ─────────────

const answer = JSON.stringify({
  slots: [
    { dayOfWeek: 0, mealType: "dinner", title: "Salmon traybake" },
    { dayOfWeek: 1, mealType: "dinner", title: "Dal" },
    { dayOfWeek: 2, mealType: "dinner", title: "Katsu" },
  ],
});
const seen: string[] = [];
const items = completedItems<{ title?: string }>("slots", (s) => seen.push(s.title ?? "?"));
for (let end = 1; end <= answer.length; end += 7) {
  try {
    items.partial(partialParse(answer.slice(0, end)));
  } catch {
    // too little to parse yet
  }
}
assert.deepEqual(seen, ["Salmon traybake", "Dal"], "the last slot isn't finished until the answer is");
items.done(JSON.parse(answer));
assert.deepEqual(seen, ["Salmon traybake", "Dal", "Katsu"], "each once, in order");

console.log("generation progress: all checks passed");
