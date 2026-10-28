/**
 * "Help me choose" for one household: the diner brief, the menu as the model
 * reads it, and one AI call with the household's key. Not a "use server"
 * module: it takes a householdId, so only code that has resolved the caller's
 * household may call it (`POST /api/v1/outside-meals/menu-picks`).
 *
 * Every problem the person can fix (no menu, a link that won't load, an
 * unknown name, no AI key) is an OutsideMealValidationError, which the API
 * answers with 400 and its message.
 */

import { pickFromMenu, type MenuPicks } from "@/lib/ai/menu-picks";
import { hasMenu, menuParts, MenuSourceError, type MenuSources } from "@/lib/ai/menu-sources";
import { getDinerBrief, UnknownDinerError } from "@/lib/services/diner-brief";
import { aiClientFor, OutsideMealValidationError } from "@/lib/services/outside-meals";
import { createLogger } from "@/lib/logger";

const log = createLogger("menu-picks");

function aiMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/api key|401/i.test(msg)) return "The AI key was rejected — check Settings → AI.";
  if (/429|quota|rate/i.test(msg)) return "The AI is rate limited right now. Try again shortly.";
  if (/file|pdf|image|unsupported/i.test(msg)) {
    return "The AI couldn't read that menu with the model set in Settings → AI. Try a photo, or paste the text.";
  }
  return "The AI couldn't read that menu. Try again, or try a clearer photo.";
}

export async function chooseFromMenu(
  householdId: string,
  { date, diners, sources }: { date: string; diners: string[]; sources: MenuSources }
): Promise<MenuPicks & { date: string }> {
  if (!hasMenu(sources)) {
    throw new OutsideMealValidationError("Add a photo of the menu, a link to it, or paste it in.");
  }
  const ai = await aiClientFor(householdId);
  if (!ai) throw new OutsideMealValidationError("AI isn't set up — add a key in Settings → AI.");

  let brief;
  try {
    brief = await getDinerBrief(householdId, { date, diners });
  } catch (err) {
    if (err instanceof UnknownDinerError) throw new OutsideMealValidationError(err.message);
    throw err;
  }

  let menu;
  try {
    menu = await menuParts(sources);
  } catch (err) {
    if (err instanceof MenuSourceError) throw new OutsideMealValidationError(err.message);
    throw err;
  }

  try {
    return { date, ...(await pickFromMenu(ai.client, ai.model, { brief, menu })) };
  } catch (err) {
    log.warn(`menu picks failed: ${err instanceof Error ? err.message : err}`);
    throw new OutsideMealValidationError(aiMessage(err));
  }
}
