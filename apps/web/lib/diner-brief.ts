/**
 * The "diner brief": what an AI choosing from a restaurant menu needs to know
 * about the people eating — their dietary requirements and dislikes, what the
 * household rates well and badly, how this week's protein targets stand and
 * what they've eaten lately. Gathered by `lib/services/diner-brief.ts`; served
 * to Claude/ChatGPT by `GET /api/integrations/preferences` and (later) used by
 * the in-app menu chooser, so both suggest the same way.
 *
 * Pure, so `scripts/check-diner-brief.ts` can check it without a database.
 */

import type { TasteProfileSummary } from "@/lib/ai/taste-summary";
import { WEEKLY_PROTEIN_TARGETS, type ProteinKind } from "@/lib/meal-stats";

export type DinerBriefMember = {
  id: string;
  name: string;
  /** Whole years on the brief's date, from the birth year; null when unknown. */
  age: number | null;
  child: boolean;
  dietaryRequirements: string[];
  dislikes: string[];
  loves: string[];
  notes: string | null;
};

export type DinerBriefProtein = {
  kind: ProteinKind;
  label: string;
  /** Meals this week containing it, eaten and still planned. */
  count: number;
  /** The weekly target ("max 1", "aim 2+") — only when a diner is on a cholesterol-lowering diet. */
  target: string | null;
  /** How the count sits against the target; null with no target. */
  status: "under" | "met" | "at_limit" | "over" | null;
};

export type DinerBriefMeal = {
  date: string;
  title: string;
  cuisine: string | null;
  /** Eaten out, a takeaway or at friends' — `place` says where. */
  outside: boolean;
  place: string | null;
  /** 1–5 stars, halves allowed; null when nobody rated it. */
  rating: number | null;
};

export type DinerBrief = {
  /** The day the meal is for, YYYY-MM-DD. */
  date: string;
  diners: DinerBriefMember[];
  /** Someone eating is on a cholesterol-lowering diet: the protein targets apply. */
  heartFocus: boolean;
  /** null until the household has rated enough meals to mean anything. */
  taste: TasteProfileSummary | null;
  week: {
    weekStartDate: string;
    meals: number;
    avgCalories: number | null;
    avgSaturatedFatG: number | null;
    avgFiberG: number | null;
    proteins: DinerBriefProtein[];
  };
  /** The 7 days before `date`, oldest first, for the diners named. */
  recentMeals: DinerBriefMeal[];
};

/** "max 1", "aim 2+", "aim none" — as the planner's nutrition strip says it. */
export function proteinTargetText(kind: ProteinKind): string | null {
  const t = WEEKLY_PROTEIN_TARGETS[kind];
  if (!t) return null;
  if (t.min !== undefined) return `aim ${t.min}+`;
  return t.max === 0 ? "aim none" : `max ${t.max}`;
}

/**
 * Where a week's count sits against its target. A maximum already reached is
 * `at_limit` rather than `met`: one more would go over, which is what someone
 * choosing from a menu needs to know.
 */
export function proteinStatus(kind: ProteinKind, count: number): DinerBriefProtein["status"] {
  const t = WEEKLY_PROTEIN_TARGETS[kind];
  if (!t) return null;
  if (t.max !== undefined) {
    if (count > t.max) return "over";
    return count === t.max ? "at_limit" : "met";
  }
  if (t.min !== undefined) return count >= t.min ? "met" : "under";
  return null;
}

/**
 * Picks the diners a caller named (display names or member ids, any case) out
 * of the household's members. An empty list means everyone. Names that match
 * nobody come back in `unknown` so the caller can say which.
 */
export function matchDiners<M extends { id: string; displayName: string }>(
  members: M[],
  wanted: string[]
): { diners: M[]; unknown: string[] } {
  const asked = wanted.map((w) => w.trim()).filter(Boolean);
  if (!asked.length) return { diners: members, unknown: [] };

  const diners: M[] = [];
  const unknown: string[] = [];
  for (const w of asked) {
    const lower = w.toLowerCase();
    const m = members.find((x) => x.id === w || x.displayName.trim().toLowerCase() === lower);
    if (!m) unknown.push(w);
    else if (!diners.includes(m)) diners.push(m);
  }
  return { diners, unknown };
}

function stars(rating: number): string {
  return `${Number.isInteger(rating) ? rating : rating.toFixed(1)}★`;
}

const STATUS_TEXT: Record<NonNullable<DinerBriefProtein["status"]>, string> = {
  under: "still short",
  met: "fine",
  at_limit: "at the limit, so avoid more this week",
  over: "already over",
};

/**
 * The brief as plain text, ready to paste into a prompt. Says only what's
 * known: no taste section until there's a taste profile, no targets unless
 * someone is on a cholesterol-lowering diet.
 */
export function renderDinerBrief(brief: DinerBrief): string {
  const out: string[] = [`Choosing a meal for ${brief.date}.`, "", "Who's eating:"];

  for (const d of brief.diners) {
    let who = d.name;
    if (d.age !== null) who += ` (age ${d.age})`;
    else if (d.child) who += " (a child)";
    const parts = [who];
    if (d.dietaryRequirements.length) parts.push(`dietary requirements: ${d.dietaryRequirements.join(", ")}`);
    if (d.dislikes.length) parts.push(`dislikes: ${d.dislikes.join(", ")}`);
    if (d.loves.length) parts.push(`loves: ${d.loves.join(", ")}`);
    if (d.notes) parts.push(d.notes);
    out.push(`- ${parts.join(" — ")}`);
  }

  if (brief.taste) {
    const t = brief.taste;
    out.push("", `Household taste (from ${t.ratedCookCount} rated meals):`);
    if (t.preferredCuisines.length) {
      out.push(`- Favourite cuisines: ${t.preferredCuisines.map((c) => `${c.name} (${c.score}/5)`).join(", ")}`);
    }
    if (t.lovedIngredients.length) out.push(`- Rate well: ${t.lovedIngredients.join(", ")}`);
    if (t.dislikedIngredients.length) out.push(`- Rate badly: ${t.dislikedIngredients.join(", ")}`);
  }

  const w = brief.week;
  out.push("", `This week (from Monday ${w.weekStartDate}, counting meals eaten and still planned — ${w.meals} in all):`);
  const averages = [
    w.avgCalories !== null ? `${Math.round(w.avgCalories)} kcal` : null,
    w.avgSaturatedFatG !== null ? `${w.avgSaturatedFatG} g saturated fat` : null,
    w.avgFiberG !== null ? `${w.avgFiberG} g fibre` : null,
  ].filter(Boolean);
  if (averages.length) out.push(`- Average per meal: ${averages.join(", ")}`);
  for (const p of w.proteins) {
    if (!p.count && !p.target) continue;
    let line = `- ${p.label}: ${p.count}`;
    if (p.target && p.status) {
      // "aim none" is met by having none, which the limit wording would muddle.
      const status = p.status === "at_limit" && p.count === 0 ? "none so far, keep it that way" : STATUS_TEXT[p.status];
      line += ` (${p.target}: ${status})`;
    }
    out.push(line);
  }

  if (brief.heartFocus) {
    out.push(
      "",
      "Someone eating is on a cholesterol-lowering diet: prefer fish (especially oily fish), poultry, beans and lentils, grilled or baked rather than fried, and sauces that aren't cream- or butter-based. Keep red and processed meat within the weekly limits above."
    );
  }

  if (brief.recentMeals.length) {
    out.push("", "Eaten in the last week:");
    for (const m of brief.recentMeals) {
      const bits = [m.title];
      if (m.cuisine) bits.push(m.cuisine);
      if (m.outside) bits.push(m.place ? `out, at ${m.place}` : "out");
      if (m.rating !== null) bits.push(`rated ${stars(m.rating)}`);
      out.push(`- ${m.date}: ${bits.join(" · ")}`);
    }
  }

  return out.join("\n");
}
