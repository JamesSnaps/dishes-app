/**
 * Checks "Help me choose" holds the model's answer to the brief: one entry per
 * diner in the brief's order whatever the model sent, a printed calorie
 * figure winning over an estimate, at most three picks each, and an unreadable
 * menu giving no picks but saying why.
 *
 * Usage (from apps/web): npx tsx scripts/check-menu-picks.ts
 * Pure — no database or network.
 */

import assert from "node:assert/strict";
import { tidyPicks, type MenuPicksReading } from "../lib/ai/menu-picks";
import { hasMenu } from "../lib/ai/menu-sources";

const pick = (dish: string, extra: Partial<MenuPicksReading["diners"][number]["picks"][number]> = {}) => ({
  dish,
  course: "main" as const,
  menuLine: `${dish}, with things`,
  menuKcal: null,
  estimatedKcal: 700,
  why: "Because.",
  lighterTweak: null,
  ...extra,
});

const reading: MenuPicksReading = {
  menuReadable: true,
  restaurant: { name: " Côte ", cuisine: "French" },
  diners: [
    { name: "sam", picks: [pick("Moules")], avoid: [] },
    {
      name: "James",
      picks: [
        pick("Sea bass", { menuKcal: 720, estimatedKcal: 650, lighterTweak: "  " }),
        pick("Chicken"),
        pick("Salad"),
        pick("Steak"),
        pick(" "),
      ],
      avoid: [{ dish: "Steak frites", why: "Red meat's at its limit." }],
    },
    { name: "Alex", picks: [pick("Burger")], avoid: [] },
  ],
  note: " ",
};

const out = tidyPicks(reading, ["James", "Sam", "Jo"]);
assert.deepEqual(out.diners.map((d) => d.name), ["James", "Sam", "Jo"], "the brief's diners, in its order");
assert.equal(out.diners[1]!.picks[0]!.dish, "Moules", "names match in any case");
assert.deepEqual(out.diners[2]!.picks, [], "a diner the model left out gets none");
assert.ok(!out.diners.some((d) => d.name === "Alex"), "nobody the brief didn't name");
assert.deepEqual(out.diners[0]!.picks.map((p) => p.dish), ["Sea bass", "Chicken", "Salad"], "three at most, none blank");
assert.equal(out.diners[0]!.picks[0]!.menuKcal, 720);
assert.equal(out.diners[0]!.picks[0]!.estimatedKcal, null, "a printed figure wins over an estimate");
assert.equal(out.diners[0]!.picks[0]!.lighterTweak, null, "a blank tweak is none");
assert.equal(out.diners[0]!.picks[1]!.estimatedKcal, 700);
assert.equal(out.diners[0]!.avoid.length, 1);
assert.deepEqual(out.restaurant, { name: "Côte", cuisine: "French" });
assert.equal(out.note, null);

const unreadable = tidyPicks({ ...reading, menuReadable: false, note: null }, ["James"]);
assert.deepEqual(unreadable.diners[0]!.picks, [], "an unreadable menu gives no picks");
assert.equal(unreadable.note, "The menu couldn't be read.", "and says so");

const none = { photos: [], pdf: null, url: null, text: null };
assert.equal(hasMenu(none), false);
assert.equal(hasMenu({ ...none, text: "  " }), false, "blank text isn't a menu");
assert.equal(hasMenu({ ...none, url: "https://example.com/menu" }), true);

console.log("menu picks checks passed");
