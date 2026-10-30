/**
 * Checks the grocery delivery reminder text (lib/deliveries/scheduler.ts):
 * before ordering it lists what's left to do; once ordered it flags items
 * added since, and the last reminder also names items that were already on
 * the list when the order went in.
 *
 * Usage (from apps/web): npx tsx scripts/check-delivery-reminders.ts
 * Pure — no database or network.
 */

import assert from "node:assert/strict";
import { buildDeliveryReminder } from "../lib/deliveries/scheduler";
import type { DeliveryReport } from "../lib/deliveries/schedule";

const today = "2026-10-30"; // Friday; Saturday's order closes tonight

function report(over: {
  status?: "scheduled" | "ordered";
  added?: string[];
  before?: string[];
  unticked?: number;
  total?: string | null;
}): DeliveryReport {
  const status = over.status ?? "ordered";
  return {
    delivery: {
      date: "2026-10-31",
      status,
      regular: true,
      away: null,
      slot: status === "ordered" ? "07:30-08:30" : null,
      total: over.total === undefined ? (status === "ordered" ? "97.25" : null) : over.total,
      orderReference: null,
      orderedAt: status === "ordered" ? new Date("2026-10-29T20:00:00Z") : null,
      source: "manual",
      cutoffDate: today,
      cutoffTime: "23:00",
    },
    checklist: {
      coverage: ["2026-10-31"],
      unplannedDinners: [],
      mealsNotOnList: 0,
      unticked: over.unticked ?? 0,
      addedSinceOrder: over.added ?? [],
      untickedBeforeOrder: over.before ?? [],
    },
    cutoffAt: Date.parse("2026-10-30T23:00:00Z"),
  };
}

const six = ["Milk", "Eggs", "Bread", "Butter", "Apples", "Rice"];

// --- Ordered, nothing outstanding ---------------------------------------------

assert.equal(buildDeliveryReminder(report({}), { today, last: false }), null);
{
  const p = buildDeliveryReminder(report({}), { today, last: true })!;
  assert.match(p.title, /^Last orders soon: Saturday's order closes/);
  assert.equal(
    p.body,
    "Ordered · 07:30-08:30 · £97.25. Nothing to change, unless you've remembered something."
  );
  assert.equal(p.url, "/settings/deliveries");
}

// --- Ordered, items left on the list from before the order --------------------

// Earlier reminders stay quiet about them: they may have been left out on purpose.
assert.equal(buildDeliveryReminder(report({ before: six }), { today, last: false }), null);
{
  const p = buildDeliveryReminder(report({ before: six }), { today, last: true })!;
  assert.match(p.title, /^Last orders soon: Saturday's order closes/);
  assert.equal(
    p.body,
    "Ordered · 07:30-08:30 · £97.25. 6 items still on the list: Milk, Eggs, Bread, Butter and 2 more. Amend them in, or tick them off."
  );
  assert.equal(p.url, "/shopping");
}
{
  const p = buildDeliveryReminder(report({ before: ["Milk"], total: null }), {
    today,
    last: true,
  })!;
  assert.equal(
    p.body,
    "Ordered · 07:30-08:30. 1 item still on the list: Milk. Amend them in, or tick them off."
  );
}

// --- Ordered, items added since -----------------------------------------------

{
  const p = buildDeliveryReminder(report({ added: ["Cheese"], before: six }), {
    today,
    last: false,
  })!;
  assert.match(p.title, /^Amend Saturday's order by/);
  assert.equal(p.body, "1 item added since you ordered: Cheese");
  assert.equal(p.url, "/shopping");
}
{
  const p = buildDeliveryReminder(report({ added: ["Cheese"], before: ["Milk", "Eggs"] }), {
    today,
    last: true,
  })!;
  assert.match(p.title, /^Last orders: amend Saturday's order by/);
  assert.equal(
    p.body,
    "1 item added since you ordered: Cheese · 2 items still on the list: Milk, Eggs"
  );
}

// --- Ordered, under the minimum -----------------------------------------------

{
  const p = buildDeliveryReminder(report({ total: "30.00", before: ["Milk"] }), {
    today,
    last: true,
    minOrderTotal: 40,
  })!;
  assert.match(p.body ?? "", /^£30\.00 is under your £40(\.00)? minimum · 1 item still on the list: Milk$/);
  assert.equal(p.url, "/shopping");
}

// --- Not ordered yet ----------------------------------------------------------

{
  const p = buildDeliveryReminder(report({ status: "scheduled", unticked: 6 }), {
    today,
    last: true,
  })!;
  assert.match(p.title, /^Last call: Saturday's delivery — order by/);
  assert.equal(p.body, "6 items not in the basket yet");
}

console.log("delivery reminders: ok");
