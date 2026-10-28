/**
 * Checks the diner brief's pure parts: matching the diners a caller named,
 * where a week's protein count sits against its target, and the plain-text
 * rendering saying only what's known.
 *
 * Usage (from apps/web): npx tsx scripts/check-diner-brief.ts
 * Pure — no database or network.
 */

import assert from "node:assert/strict";
import { matchDiners, proteinStatus, proteinTargetText, renderDinerBrief, type DinerBrief } from "../lib/diner-brief";

// ── matchDiners ───────────────────────────────────────────────────────────────

const members = [
  { id: "a", displayName: "James" },
  { id: "b", displayName: "Sam" },
];
assert.deepEqual(matchDiners(members, []).diners, members, "nobody named: everyone");
assert.deepEqual(matchDiners(members, ["", " "]).diners, members, "blank names: everyone");
assert.deepEqual(matchDiners(members, [" sam "]).diners, [members[1]], "names match any case, trimmed");
assert.deepEqual(matchDiners(members, ["a", "James"]).diners, [members[0]], "an id and a name for one person: once");
assert.deepEqual(matchDiners(members, ["Sam", "Alex"]).unknown, ["Alex"], "unknown names come back");

// ── targets ───────────────────────────────────────────────────────────────────

assert.equal(proteinTargetText("redMeat"), "max 1");
assert.equal(proteinTargetText("oilyFish"), "aim 2+");
assert.equal(proteinTargetText("processedMeat"), "aim none");
assert.equal(proteinTargetText("poultry"), null);

assert.equal(proteinStatus("redMeat", 0), "met");
assert.equal(proteinStatus("redMeat", 1), "at_limit", "a maximum reached is at the limit, not met");
assert.equal(proteinStatus("redMeat", 2), "over");
assert.equal(proteinStatus("processedMeat", 0), "at_limit", "max 0: none at all is already the limit");
assert.equal(proteinStatus("oilyFish", 1), "under");
assert.equal(proteinStatus("oilyFish", 2), "met");
assert.equal(proteinStatus("poultry", 5), null);

// ── renderDinerBrief ──────────────────────────────────────────────────────────

const brief: DinerBrief = {
  date: "2026-10-28",
  diners: [
    {
      id: "a",
      name: "James",
      age: 44,
      child: false,
      dietaryRequirements: ["Cholesterol-lowering"],
      dislikes: ["blue cheese"],
      loves: [],
      notes: null,
    },
    { id: "b", name: "Sam", age: null, child: true, dietaryRequirements: [], dislikes: [], loves: [], notes: null },
  ],
  heartFocus: true,
  taste: null,
  week: {
    weekStartDate: "2026-10-26",
    meals: 3,
    avgCalories: 612.4,
    avgSaturatedFatG: null,
    avgFiberG: null,
    proteins: [
      { kind: "redMeat", label: "Red meat", count: 1, target: "max 1", status: "at_limit" },
      { kind: "poultry", label: "Poultry", count: 0, target: null, status: null },
      { kind: "oilyFish", label: "Oily fish", count: 0, target: "aim 2+", status: "under" },
      { kind: "processedMeat", label: "Processed meat", count: 0, target: "aim none", status: "at_limit" },
    ],
  },
  recentMeals: [
    { date: "2026-10-25", title: "Burger", cuisine: "American", outside: true, place: "Byron", rating: 3.5 },
  ],
};

const text = renderDinerBrief(brief);
assert.match(text, /- James \(age 44\) — dietary requirements: Cholesterol-lowering — dislikes: blue cheese/);
assert.match(text, /- Sam \(a child\)$/m, "a child with no birth year still says so");
assert.doesNotMatch(text, /Household taste/, "no taste section without a taste profile");
assert.match(text, /Average per meal: 612 kcal$/m, "only the averages that are known");
assert.match(text, /Red meat: 1 \(max 1: at the limit/);
assert.match(text, /Oily fish: 0 \(aim 2\+: still short\)/, "a target still shows with nothing eaten yet");
assert.match(text, /Processed meat: 0 \(aim none: none so far, keep it that way\)/);
assert.doesNotMatch(text, /Poultry/, "a protein with no meals and no target is left out");
assert.match(text, /cholesterol-lowering diet: prefer fish/);
assert.match(text, /2026-10-25: Burger · American · out, at Byron · rated 3\.5★/);

const plain = renderDinerBrief({ ...brief, heartFocus: false, recentMeals: [] });
assert.doesNotMatch(plain, /cholesterol-lowering diet: prefer/);
assert.doesNotMatch(plain, /Eaten in the last week/);

console.log("diner brief checks passed");
