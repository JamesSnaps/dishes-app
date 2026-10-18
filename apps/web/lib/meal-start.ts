/**
 * "When did you start?" for a scheduled meal in cooking mode. People often
 * start a meal before opening the app (step one done from memory), so cooking
 * mode asks once, at the start, and keeps the schedule in step with the answer
 * — never by watching which step is on screen, since cooks read ahead.
 *
 * Pure and client-safe; the iOS app has the same rules in CookingView.swift.
 */

/** One schedule cue as clock times (epoch ms), as cooking mode holds them. */
export interface StartCue {
  id: string;
  at: number;
  recipeId: string | null;
  stepIndex: number | null;
}

/** A start this close to the schedule counts as on time: nothing to move. */
export const ON_TIME_MINUTES = 5;

/** Within this of the due time, the picker suggests the due time, not now. */
const SNAP_TO_DUE_MINUTES = 10;

/** The schedule's first job: what it says to start, and when. */
export function firstCue<C extends StartCue>(cues: C[]): C | null {
  return cues.find((c) => c.id !== "serve" && c.recipeId !== null) ?? null;
}

/** Epoch ms rounded down to the minute — times here are whole minutes. */
export function toMinute(epoch: number): number {
  return Math.floor(epoch / 60_000) * 60_000;
}

/** What "I started at…" suggests: now, or the due time if that's close. */
export function suggestedStart(now: number, dueAt: number): number {
  return Math.abs(now - dueAt) <= SNAP_TO_DUE_MINUTES * 60_000 ? dueAt : toMinute(now);
}

/** Whole minutes the start is off the schedule: negative = early. */
export function startDelta(startedAt: number, dueAt: number): number {
  return Math.round((toMinute(startedAt) - toMinute(dueAt)) / 60_000);
}

/**
 * The step the schedule says the dish should be on, `elapsed` ms after it
 * started: the last of its cues that has come round since the first.
 */
export function stepAfter(cues: StartCue[], recipeId: string, elapsed: number): number {
  const own = cues.filter((c) => c.recipeId === recipeId && c.stepIndex !== null);
  const start = own[0]?.at;
  if (start === undefined) return 0;
  let step = own[0]!.stepIndex!;
  for (const c of own) if (c.at - start <= elapsed) step = Math.max(step, c.stepIndex!);
  return step;
}

/** The cues moved by `minutes` — all of them, or one dish's. */
export function shiftCues<C extends StartCue>(cues: C[], minutes: number, recipeId?: string): C[] {
  if (!minutes) return cues;
  return cues.map((c) =>
    recipeId === undefined || c.recipeId === recipeId ? { ...c, at: c.at + minutes * 60_000 } : c
  );
}

/** "HH:MM" in the device's clock for an epoch. */
export function clockOf(epoch: number): string {
  return new Date(epoch).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "<input type=time>" value → epoch ms on the same day as `day`. */
export function timeOnDay(hhmm: string, day: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(day);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

/** "20 min", "1 h 5 min". */
export function minutesLabel(total: number): string {
  const m = Math.abs(total);
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}
