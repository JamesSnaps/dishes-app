/**
 * A scheduled meal cooked as one sequence: every dish's steps (and the
 * schedule's notes and combined prep steps) in schedule order, walked with
 * Next and Back whichever dish each belongs to.
 *
 * Pure and client-safe. The iOS app has the same rules in
 * DishesCore/Models/MealSequence.swift — change them together.
 */

import type { CookCue } from "@/components/providers/cook-session-provider";

/** Two cues this close together count as "also now" for each other. */
export const ALSO_NOW_MS = 2 * 60_000;

/**
 * The recipe steps a cue does: its own, or a combined prep cue's (or the serve
 * cue's: each dish's last step when that's only serving it).
 */
export function stepsOf(cue: CookCue): { recipeId: string; stepIndex: number }[] {
  if (cue.covers?.length) return cue.covers;
  return cue.recipeId && cue.stepIndex !== null ? [{ recipeId: cue.recipeId, stepIndex: cue.stepIndex }] : [];
}

/**
 * The dish whose page a cue is shown on: its own, the first a combined step
 * covers, else (a note, serving) the nearest dish before it, then after.
 */
export function anchorOf(cues: CookCue[], index: number): string | null {
  const own = (c: CookCue | undefined) => c?.recipeId ?? c?.covers?.[0]?.recipeId ?? null;
  for (let i = index; i >= 0; i--) {
    const id = own(cues[i]);
    if (id) return id;
  }
  for (let i = index + 1; i < cues.length; i++) {
    const id = own(cues[i]);
    if (id) return id;
  }
  return null;
}

/** Where a dish's step sits in the sequence, or −1. */
export function indexOfStep(cues: CookCue[], recipeId: string, stepIndex: number): number {
  return cues.findIndex((c) => stepsOf(c).some((s) => s.recipeId === recipeId && s.stepIndex === stepIndex));
}

/** The place in the sequence: the stored cue, else the start. */
export function indexOfPosition(cues: CookCue[], position: string | undefined): number {
  const i = position ? cues.findIndex((c) => c.id === position) : -1;
  return i >= 0 ? i : 0;
}

/** The step the clock says you're on: the last cue due by `now` (never serving early). */
export function positionAt(cues: CookCue[], now: number): CookCue | null {
  let found: CookCue | null = null;
  for (const c of cues) if (c.at <= now && c.id !== "serve") found = c;
  return found ?? cues[0] ?? null;
}

/** Other steps due at the same time as the one at `index` — two dishes at once. */
export function alsoNow(cues: CookCue[], index: number): { cue: CookCue; index: number }[] {
  const here = cues[index];
  if (!here) return [];
  return cues
    .map((cue, i) => ({ cue, index: i }))
    .filter(({ cue, index: i }) => i !== index && cue.id !== "serve" && Math.abs(cue.at - here.at) <= ALSO_NOW_MS);
}

/** "in 25 min", "Now", "10 min late" — how a step's time stands against the clock. */
export function dueLabel(at: number, now: number): { text: string; tone: "ahead" | "now" | "late" } {
  const mins = Math.round((at - now) / 60_000);
  if (mins > 0) return { text: `in ${span(mins)}`, tone: "ahead" };
  if (mins >= -5) return { text: "Now", tone: "now" };
  return { text: `${span(-mins)} late`, tone: "late" };
}

function span(m: number): string {
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}
