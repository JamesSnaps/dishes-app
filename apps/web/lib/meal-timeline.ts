import { MEAL_ROLES, type MealRole } from "@dishes/shared";
import { minutesToTime, timeToMinutes } from "@/lib/dinner-reminders/time";

/**
 * Cooking schedules for combined meals: when to start each dish's steps so
 * everything is ready together.
 *
 * A schedule is a list of cues measured in minutes before serving (negative
 * numbers, 0 = serve), so moving the serve time shifts it without replanning.
 * Each cue points at a real recipe step where it can — the words on screen and
 * in the notification are the recipe's own — plus the odd coordinating note
 * ("turn the oven up") an AI-planned schedule may add.
 *
 * Pure and client-safe: the planner, cooking mode and the push scheduler all
 * read schedules through here.
 */

export type TimelineStepInput = {
  instruction: string;
  durationMinutes: number | null;
  timerLabel: string | null;
};

export type TimelineDishInput = {
  recipeId: string;
  title: string;
  role: MealRole;
  steps: TimelineStepInput[];
};

export type TimelineCue = {
  /** Stable within a schedule — notifications are de-duplicated on it. */
  id: string;
  /** Minutes before serving (≤ 0). */
  offsetMinutes: number;
  /** The dish this is for; null for a whole-meal note or the serve cue. */
  recipeId: string | null;
  /** The recipe step this starts; null for a coordinating note. */
  stepIndex: number | null;
  text: string;
};

export type MealTimeline = {
  cues: TimelineCue[];
  warnings: string[];
  source: "auto" | "ai";
  /** Fingerprint of the dishes and steps it was planned from — see `timelineInputsKey`. */
  inputsKey: string;
};

/** Steps without a time still take some: a little, rather than none. */
export const DEFAULT_STEP_MINUTES = 5;

/** Longest schedule we'll accept — a day. Anything beyond is a bad duration. */
export const MAX_LEAD_MINUTES = 24 * 60;

const SERVE_CUE_ID = "serve";

/**
 * A fingerprint of what a schedule depends on: which dishes, and their steps'
 * durations. A stored schedule whose key no longer matches was planned for a
 * different meal (a dish swapped, a step retimed) and is treated as stale.
 */
export function timelineInputsKey(dishes: TimelineDishInput[]): string {
  const raw = [...dishes]
    .sort((a, b) => a.recipeId.localeCompare(b.recipeId))
    .map((d) => `${d.recipeId}:${d.steps.map((s) => s.durationMinutes ?? "-").join(",")}`)
    .join("|");
  // djb2 — compact and stable; this is a change detector, not security.
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** An oven temperature in a step's text, in °C: "200°C", "200C", "400°F". */
export function ovenTempOf(text: string): number | null {
  const c = /(\d{2,3})\s*°?\s*C\b/i.exec(text);
  if (c) return Number(c[1]);
  const f = /(\d{3})\s*°?\s*F\b/i.exec(text);
  if (f) return Math.round(((Number(f[1]) - 32) * 5) / 9 / 5) * 5;
  return null;
}

/** A step's instruction cut down to a cue: its first sentence, kept short. */
export function cueText(step: TimelineStepInput): string {
  const first = step.instruction.split(/(?<=[.!?])\s/)[0]?.trim() ?? step.instruction;
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
}

function stepMinutes(step: TimelineStepInput): number {
  return step.durationMinutes && step.durationMinutes > 0
    ? step.durationMinutes
    : DEFAULT_STEP_MINUTES;
}

/** Cue order: earliest first; ties main → side → sauce, then by step. */
export function sortCues(cues: TimelineCue[], dishes: TimelineDishInput[]): TimelineCue[] {
  const roleOf = new Map(dishes.map((d) => [d.recipeId, MEAL_ROLES.indexOf(d.role)]));
  return [...cues].sort(
    (a, b) =>
      a.offsetMinutes - b.offsetMinutes ||
      (a.recipeId === null ? 1 : 0) - (b.recipeId === null ? 1 : 0) ||
      (roleOf.get(a.recipeId ?? "") ?? 9) - (roleOf.get(b.recipeId ?? "") ?? 9) ||
      (a.stepIndex ?? 0) - (b.stepIndex ?? 0)
  );
}

/**
 * The simple schedule: each dish's steps back to back, ending as the meal is
 * served, so the longest dish starts first. No AI, always available.
 *
 * It can't know that a two-hour roast needs you for two minutes, so it never
 * overlaps a dish's own steps. It does flag the one clash that ruins a roast:
 * two dishes wanting the oven at different temperatures at the same time.
 */
export function autoTimeline(dishes: TimelineDishInput[]): MealTimeline {
  const cues: TimelineCue[] = [];
  const ovenUse: { title: string; temp: number; from: number; to: number }[] = [];

  for (const dish of dishes) {
    const total = dish.steps.reduce((n, s) => n + stepMinutes(s), 0);
    let at = -Math.min(total, MAX_LEAD_MINUTES);
    dish.steps.forEach((step, i) => {
      cues.push({
        id: `${dish.recipeId}:${i}`,
        offsetMinutes: at,
        recipeId: dish.recipeId,
        stepIndex: i,
        text: cueText(step),
      });
      const temp = ovenTempOf(step.instruction);
      if (temp !== null && step.durationMinutes) {
        ovenUse.push({ title: dish.title, temp, from: at, to: at + step.durationMinutes });
      }
      at += stepMinutes(step);
    });
  }

  cues.push({ id: SERVE_CUE_ID, offsetMinutes: 0, recipeId: null, stepIndex: null, text: "Serve" });

  const warnings: string[] = [];
  for (let i = 0; i < ovenUse.length; i++) {
    for (let j = i + 1; j < ovenUse.length; j++) {
      const a = ovenUse[i]!;
      const b = ovenUse[j]!;
      const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from);
      if (overlap > 0 && a.temp !== b.temp && a.title !== b.title) {
        warnings.push(
          `${a.title} wants the oven at ${a.temp}°C while ${b.title} wants ${b.temp}°C, ` +
            `for ${overlap} min (from ${-Math.max(a.from, b.from)} min before serving).`
        );
      }
    }
  }

  return {
    cues: sortCues(cues, dishes),
    warnings,
    source: "auto",
    inputsKey: timelineInputsKey(dishes),
  };
}

/**
 * Tidy a schedule from an untrusted source (the AI) against the real dishes:
 * unknown dishes and steps become plain notes or are dropped, offsets are
 * clamped to before serving, any step the planner forgot is put back where the
 * simple schedule would have it, and there is always exactly one serve cue.
 */
export function reconcileTimeline(
  proposed: { offsetMinutes: number; recipeId: string | null; stepIndex: number | null; text: string }[],
  warnings: string[],
  dishes: TimelineDishInput[]
): MealTimeline {
  const byId = new Map(dishes.map((d) => [d.recipeId, d]));
  const seen = new Set<string>();
  const cues: TimelineCue[] = [];
  let notes = 0;

  for (const p of proposed) {
    const offset = Math.max(-MAX_LEAD_MINUTES, Math.min(0, Math.round(p.offsetMinutes)));
    const dish = p.recipeId ? byId.get(p.recipeId) : undefined;
    // A dish that isn't in this meal: the planner made it up. Drop the cue.
    if (p.recipeId && !dish) continue;
    const recipeId = dish ? dish.recipeId : null;
    const validStep =
      dish && p.stepIndex !== null && p.stepIndex >= 0 && p.stepIndex < dish.steps.length;
    const text = p.text.trim().slice(0, 140);
    if (!text) continue;

    if (validStep) {
      const id = `${recipeId}:${p.stepIndex}`;
      if (seen.has(id)) continue;
      seen.add(id);
      cues.push({ id, offsetMinutes: offset, recipeId, stepIndex: p.stepIndex, text });
    } else if (!/^serve\b/i.test(text) || offset !== 0) {
      cues.push({ id: `note:${notes++}`, offsetMinutes: offset, recipeId, stepIndex: null, text });
    }
  }

  // Anything left out goes back in at its simple-schedule time.
  for (const cue of autoTimeline(dishes).cues) {
    if (cue.stepIndex !== null && !seen.has(cue.id)) cues.push(cue);
  }

  // A dish's steps happen in order: a step scheduled before the one ahead of it
  // starts with it instead, never before.
  for (const dish of dishes) {
    let floor = -Infinity;
    for (let i = 0; i < dish.steps.length; i++) {
      const cue = cues.find((c) => c.recipeId === dish.recipeId && c.stepIndex === i);
      if (!cue) continue;
      if (cue.offsetMinutes < floor) cue.offsetMinutes = floor;
      floor = cue.offsetMinutes;
    }
  }
  cues.push({ id: SERVE_CUE_ID, offsetMinutes: 0, recipeId: null, stepIndex: null, text: "Serve" });

  return {
    cues: sortCues(cues, dishes),
    warnings: warnings.map((w) => w.trim().slice(0, 240)).filter(Boolean).slice(0, 6),
    source: "ai",
    inputsKey: timelineInputsKey(dishes),
  };
}

/** A stored timeline, if it's well-formed — the column is JSON from anywhere. */
export function parseStoredTimeline(value: unknown): MealTimeline | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<MealTimeline>;
  if (!Array.isArray(v.cues) || typeof v.inputsKey !== "string") return null;
  return {
    cues: v.cues.filter(
      (c): c is TimelineCue =>
        !!c && typeof c.id === "string" && typeof c.offsetMinutes === "number" && typeof c.text === "string"
    ),
    warnings: Array.isArray(v.warnings) ? v.warnings.filter((w) => typeof w === "string") : [],
    source: v.source === "ai" ? "ai" : "auto",
    inputsKey: v.inputsKey,
  };
}

/** "16:00" and −130 → "13:50". */
export function cueClock(serveAt: string, offsetMinutes: number): string {
  return minutesToTime(timeToMinutes(serveAt) + offsetMinutes);
}
