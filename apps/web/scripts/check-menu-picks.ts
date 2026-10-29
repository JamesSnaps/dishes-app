/**
 * Checks "Help me choose" holds the AI to the brief and the ask: picks name
 * real menu items for the right person and course, no more options than
 * asked for, nothing a swap excluded; the menu reading is tidied and numbered;
 * a section suggests its course; a streamed array hands on each element once
 * it's finished; and the brief's facts say what's being weighed.
 *
 * Usage (from apps/web): npx tsx scripts/check-menu-picks.ts
 * Pure — no database or network.
 */

import assert from "node:assert/strict";
import { pickFilter, type MenuWants } from "../lib/ai/menu-picks";
import { courseOfSection, MenuUnreadableError, tidyMenu, type ReadMenu } from "../lib/ai/menu-reader";
import { hasMenu } from "../lib/ai/menu-sources";
import { completedItems } from "../lib/ai/stream-structured";
import { briefFacts, type DinerBrief } from "../lib/diner-brief";

// ── tidyMenu ──────────────────────────────────────────────────────────────────

const menu: ReadMenu = tidyMenu({
  menuReadable: true,
  restaurant: { name: " Côte ", cuisine: "French" },
  items: [
    { section: "Starters", name: "French onion soup", description: "gruyère  croûte", kcal: null },
    { section: "Mains", name: "Sea bass", description: "crushed potatoes, beurre blanc", kcal: 720 },
    { section: "Mains", name: "Steak frites", description: null, kcal: 0 },
    { section: "Mains", name: " ", description: "a blank name", kcal: null },
    { section: "Desserts", name: "Crème brûlée", description: null, kcal: 12000 },
  ],
});
assert.deepEqual(menu.restaurant, { name: "Côte", cuisine: "French" });
assert.deepEqual(menu.items.map((i) => i.id), [1, 2, 3, 4], "numbered from 1, blank names dropped");
assert.equal(menu.items[0]!.line, "French onion soup, gruyère croûte", "name and description, spaces tidied");
assert.equal(menu.items[2]!.line, "Steak frites", "no description: the name alone");
assert.equal(menu.items[1]!.kcal, 720);
assert.equal(menu.items[2]!.kcal, null, "0 kcal isn't a printed figure");
assert.equal(menu.items[3]!.kcal, null, "nor is an impossible one");
assert.throws(() => tidyMenu({ menuReadable: false, restaurant: { name: null, cuisine: null }, items: [] }), MenuUnreadableError);
assert.throws(
  () => tidyMenu({ menuReadable: true, restaurant: { name: null, cuisine: null }, items: [{ section: null, name: "", description: null, kcal: null }] }),
  MenuUnreadableError,
  "readable but no dishes is still no menu"
);

// ── courseOfSection ───────────────────────────────────────────────────────────

assert.equal(courseOfSection("Small plates"), "starter");
assert.equal(courseOfSection("Puddings"), "dessert");
assert.equal(courseOfSection("Sides & extras"), "side");
assert.equal(courseOfSection("Cocktails"), "drink");
assert.equal(courseOfSection("From the grill"), "main");
assert.equal(courseOfSection(null), "main");

// ── pickFilter ────────────────────────────────────────────────────────────────

const wants: MenuWants = { courses: ["starter", "main"], moods: [], note: null };
const raw = (diner: string, course: "starter" | "main" | "dessert", item: number, extra: Partial<{ estimatedKcal: number | null; lighterTweak: string | null }> = {}) => ({
  diner,
  course,
  item,
  why: " Because. ",
  lighterTweak: null,
  estimatedKcal: 650,
  ...extra,
});

const f = pickFilter({ names: ["James", "Sam"], menu, wants, swap: null });
const sea = f.pick(raw("james", "main", 2, { lighterTweak: "  " }));
assert.ok(sea, "names match in any case");
assert.equal(sea.diner, "James");
assert.equal(sea.dish, "Sea bass", "the dish comes from the menu, not the model");
assert.equal(sea.menuLine, "Sea bass, crushed potatoes, beurre blanc");
assert.equal(sea.menuKcal, 720);
assert.equal(sea.estimatedKcal, null, "a printed figure wins over an estimate");
assert.equal(sea.lighterTweak, null, "a blank tweak is none");
assert.equal(sea.why, "Because.");
assert.equal(f.pick(raw("James", "main", 3))?.estimatedKcal, 650, "no printed figure: the estimate stands");
assert.equal(f.pick(raw("Sam", "starter", 1, { lighterTweak: "Ask for: less cheese" }))?.lighterTweak, "Less cheese", "'Ask for' isn't doubled");
assert.equal(f.pick(raw("James", "main", 2)), null, "the same dish twice for the same course");
assert.equal(f.pick(raw("Alex", "main", 1)), null, "nobody the brief didn't name");
assert.equal(f.pick(raw("James", "main", 99)), null, "an item that isn't on the menu");
assert.equal(f.pick(raw("James", "dessert", 4)), null, "a course nobody asked for");
assert.ok(f.pick(raw("James", "starter", 1)));
assert.ok(f.pick(raw("James", "starter", 4)));
assert.equal(f.pick(raw("James", "starter", 3)), null, "two starter options at most");
assert.ok(f.pick(raw("Sam", "main", 2)), "another person can have the same dish");
assert.ok(f.pick(raw("James", "main", 4)), "a third main option");
assert.equal(f.pick(raw("James", "main", 1)), null, "but not a fourth");

const avoid = f.avoid({ diner: "sam", item: 3, why: "Red meat's at its limit." });
assert.deepEqual(avoid, { diner: "Sam", item: 3, dish: "Steak frites", why: "Red meat's at its limit." });
assert.equal(f.avoid({ diner: "Sam", item: 42, why: "?" }), null);

const swap = pickFilter({ names: ["James", "Sam"], menu, wants, swap: { diner: "James", course: "main", exclude: [2], hint: null } });
assert.equal(swap.pick(raw("James", "main", 2)), null, "a swap never offers what it was asked to replace");
assert.equal(swap.pick(raw("Sam", "main", 3)), null, "a swap is for one person");
assert.equal(swap.pick(raw("James", "starter", 1)), null, "and one course");
assert.ok(swap.pick(raw("James", "main", 3)));
assert.ok(swap.pick(raw("James", "main", 4)));
assert.equal(swap.pick(raw("James", "main", 1)), null, "two swap options at most");
assert.equal(swap.avoid({ diner: "James", item: 3, why: "x" }), null, "no avoid list on a swap");

// ── completedItems ────────────────────────────────────────────────────────────

const got: string[] = [];
const items = completedItems<{ name: string }>("items", (it) => got.push(it.name));
items.partial({ items: [{ name: "So" }] });
assert.deepEqual(got, [], "the element still being written isn't finished");
items.partial({ items: [{ name: "Soup" }, { name: "Sea" }] });
assert.deepEqual(got, ["Soup"], "an element is finished once the next has started");
items.partial(null);
items.partial({ other: true });
items.done({ items: [{ name: "Soup" }, { name: "Sea bass" }] });
assert.deepEqual(got, ["Soup", "Sea bass"], "the rest at the end, each once");

// ── briefFacts ────────────────────────────────────────────────────────────────

const brief: DinerBrief = {
  date: "2026-10-29",
  diners: [
    { id: "a", name: "James", age: 44, child: false, dietaryRequirements: ["Cholesterol-lowering"], dislikes: ["blue cheese"], loves: [], notes: null },
  ],
  heartFocus: true,
  taste: { ratedCookCount: 20, preferredCuisines: [{ name: "Indian", score: 4.6 }], lovedIngredients: [], dislikedIngredients: [] },
  week: {
    weekStartDate: "2026-10-26",
    meals: 3,
    avgCalories: null,
    avgSaturatedFatG: null,
    avgFiberG: null,
    proteins: [
      { kind: "oilyFish", label: "Oily fish", count: 0, target: "aim 2+", status: "under" },
      { kind: "redMeat", label: "Red meat", count: 1, target: "max 1", status: "at_limit" },
      { kind: "processedMeat", label: "Processed meat", count: 0, target: "aim none", status: "at_limit" },
    ],
  },
  recentMeals: [],
};
const facts = briefFacts(brief);
assert.deepEqual(facts, [
  "You: cholesterol-lowering",
  "No oily fish yet this week",
  "Red meat's at its limit this week",
  "You don't like blue cheese",
  "You rate Indian food highly",
]);
assert.ok(!facts.some((t) => t.startsWith("Processed meat")), "none of a 'none' target isn't news");
assert.equal(briefFacts(brief, 2).length, 2);

// ── hasMenu ───────────────────────────────────────────────────────────────────

const none = { photos: [], pdf: null, url: null, text: null };
assert.equal(hasMenu(none), false);
assert.equal(hasMenu({ ...none, text: "  " }), false, "blank text isn't a menu");
assert.equal(hasMenu({ ...none, url: "https://example.com/menu" }), true);

console.log("menu picks checks passed");
