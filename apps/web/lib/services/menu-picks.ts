/**
 * "Help me choose" for one household, as a stream of events the chooser
 * shows as they come: what the brief says it's weighing, each dish as the
 * menu is read, the menu, each pick, then done. Two AI calls with the
 * household's key — read the menu, then choose — or only the second for a
 * swap, which sends back the menu read the first time.
 *
 * Not a "use server" module: it takes a householdId, so only code that has
 * resolved the caller's household may call it (`POST
 * /api/v1/outside-meals/menu-picks`). Problems the person can fix before any
 * AI runs (no menu, an unknown name, no AI key) throw
 * OutsideMealValidationError, which the API answers with 400; ones found
 * while working arrive as an `error` event.
 */

import type { OutsideMealCourseType } from "@dishes/shared";
import { pickFromMenu, type MenuPicks, type MenuSwap, type MenuWants } from "@/lib/ai/menu-picks";
import type { MenuPickEvent } from "@/lib/menu-choice";
import { MenuUnreadableError, readMenu, type ReadMenu } from "@/lib/ai/menu-reader";
import { hasMenu, menuParts, MenuSourceError, type MenuSources } from "@/lib/ai/menu-sources";
import { briefFacts } from "@/lib/diner-brief";
import { getDinerBrief, UnknownDinerError } from "@/lib/services/diner-brief";
import { aiClientFor, OutsideMealValidationError } from "@/lib/services/outside-meals";
import { createLogger } from "@/lib/logger";

const log = createLogger("menu-picks");

export type { MenuPickEvent };

export type MenuPicksRequest = {
  date: string;
  /** Display names or ids; empty means everyone. */
  diners: string[];
  wants: MenuWants;
  sources: MenuSources;
  /** The menu read last time, for a swap or a second ask: skips reading it again. */
  menu: ReadMenu | null;
  swap: MenuSwap | null;
};

export const DEFAULT_COURSES: OutsideMealCourseType[] = ["main"];

function aiMessage(err: unknown): string {
  if (err instanceof MenuSourceError || err instanceof MenuUnreadableError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (/api key|401/i.test(msg)) return "The AI key was rejected — check Settings → AI.";
  if (/429|quota|rate/i.test(msg)) return "The AI is rate limited right now. Try again shortly.";
  if (/file|pdf|image|unsupported/i.test(msg)) {
    return "The AI couldn't read that menu with the model set in Settings → AI. Try a photo, or paste the text.";
  }
  return "The AI couldn't work through that menu. Try again, or try a clearer photo.";
}

/**
 * Checks what can be checked before any AI runs, and returns the diners'
 * names (the brief's order) and the work to do, which emits events as it goes
 * and never throws (a failure is an `error` event).
 */
export async function prepareMenuPicks(householdId: string, req: MenuPicksRequest) {
  if (!req.menu && !hasMenu(req.sources)) {
    throw new OutsideMealValidationError("Add a photo of the menu, a link to it, or paste it in.");
  }
  const ai = await aiClientFor(householdId);
  if (!ai) throw new OutsideMealValidationError("AI isn't set up — add a key in Settings → AI.");

  let brief;
  try {
    brief = await getDinerBrief(householdId, { date: req.date, diners: req.diners });
  } catch (err) {
    if (err instanceof UnknownDinerError) throw new OutsideMealValidationError(err.message);
    throw err;
  }
  const swap = req.swap;
  if (swap) {
    const diner = brief.diners.find((d) => d.name.toLowerCase() === swap.diner.trim().toLowerCase());
    if (!diner) throw new OutsideMealValidationError(`${swap.diner} isn't one of the people eating.`);
    swap.diner = diner.name;
  }
  const wants: MenuWants = { ...req.wants, courses: req.wants.courses.length ? req.wants.courses : DEFAULT_COURSES };

  const names = brief.diners.map((d) => d.name);
  const { client, model } = ai;
  const dinerBrief = brief;
  async function run(emit: (e: MenuPickEvent) => void): Promise<void> {
    try {
      if (!swap) for (const text of briefFacts(dinerBrief)) emit({ type: "fact", text });

      let menu = req.menu;
      if (!menu) {
        if (req.sources.url?.trim()) emit({ type: "stage", text: "Fetching the menu" });
        const parts = await menuParts(req.sources);
        emit({ type: "stage", text: "Reading the menu" });
        menu = await readMenu(client, model, parts, (name) => emit({ type: "dish", name }));
        emit({ type: "menu", menu });
      }

      emit({ type: "stage", text: swap ? `Finding another ${swap.course}` : "Choosing for you" });
      const { note } = await pickFromMenu(client, model, {
        brief: dinerBrief,
        menu,
        wants,
        swap,
        onPick: (pick) => emit({ type: "pick", pick }),
        onAvoid: (avoid) => emit({ type: "avoid", avoid }),
      });
      emit({ type: "done", date: req.date, note });
    } catch (err) {
      log.warn(`menu picks failed: ${err instanceof Error ? err.message : err}`);
      emit({ type: "error", message: aiMessage(err) });
    }
  }
  return { names, run };
}

/**
 * The events gathered into one answer, for clients that don't stream (the
 * iOS app before 1.73.0 expects this shape). An `error` event throws.
 */
export function collectMenuPicks(events: MenuPickEvent[], names: string[]): MenuPicks {
  const error = events.find((e) => e.type === "error");
  if (error?.type === "error") throw new OutsideMealValidationError(error.message);
  const menu = events.find((e) => e.type === "menu");
  const done = events.find((e) => e.type === "done");
  const picks = events.flatMap((e) => (e.type === "pick" ? [e.pick] : []));
  const avoid = events.flatMap((e) => (e.type === "avoid" ? [e.avoid] : []));
  const diners = [...new Set([...names, ...picks.map((p) => p.diner)])];
  return {
    date: done?.type === "done" ? done.date : "",
    restaurant: menu?.type === "menu" ? menu.menu.restaurant : { name: null, cuisine: null },
    diners: diners.map((name) => ({
      name,
      picks: picks.filter((p) => p.diner === name),
      avoid: avoid.filter((a) => a.diner === name),
    })),
    note: done?.type === "done" ? done.note : null,
    menu: menu?.type === "menu" ? menu.menu : { restaurant: { name: null, cuisine: null }, items: [] },
  };
}
