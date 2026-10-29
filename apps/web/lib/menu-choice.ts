/**
 * The shapes "Help me choose" passes between server and chooser — the menu
 * as read, picks, the mood chips, the stream's events — with nothing
 * server-only in them, so the web chooser can import them too. The AI calls
 * are in `lib/ai/menu-reader.ts` and `lib/ai/menu-picks.ts`.
 */

import type { OutsideMealCourseType } from "@dishes/shared";

/** One dish on the menu. `id` counts from 1 in the order read. */
export type MenuItem = {
  id: number;
  /** The heading it's under, as written ("Starters", "From the grill"), or null. */
  section: string | null;
  name: string;
  /** Name and description as one line, word for word, without the price. */
  line: string;
  /** Printed on the menu, or null. */
  kcal: number | null;
};

export type ReadMenu = {
  restaurant: { name: string | null; cuisine: string | null };
  items: MenuItem[];
};

/** The course a menu section suggests ("Desserts" → dessert), for dishes picked from the whole menu. */
export function courseOfSection(section: string | null): OutsideMealCourseType {
  const s = (section ?? "").toLowerCase();
  if (/starter|appeti[sz]er|small plate|to start|antipast|nibble|tapas|mezze|soup/.test(s)) return "starter";
  if (/dessert|pudding|sweet|afters/.test(s)) return "dessert";
  if (/side|extra|accompaniment/.test(s)) return "side";
  if (/drink|wine|beer|cocktail|beverage|soft|coffee|tea\b/.test(s)) return "drink";
  return "main";
}

/** The mood chips. */
export const MENU_MOODS = ["light", "hearty", "healthy", "new", "treat"] as const;
export type MenuMood = (typeof MENU_MOODS)[number];
export const MENU_MOOD_LABELS: Record<MenuMood, string> = {
  light: "Light",
  hearty: "Hearty",
  healthy: "Healthy",
  new: "Something new",
  treat: "Treat",
};

/** The reason chips on "Something else", sent as the swap's hint. */
export const SWAP_REASONS = ["Lighter", "More filling", "No fish", "No meat", "Something different"] as const;

export type MenuPick = {
  /** The menu item's number. */
  item: number;
  diner: string;
  course: OutsideMealCourseType;
  dish: string;
  /** The dish's line from the menu, word for word. */
  menuLine: string;
  /** Printed on the menu; null when it isn't. */
  menuKcal: number | null;
  /** The AI's rough figure for a restaurant portion, when nothing's printed. */
  estimatedKcal: number | null;
  /** Why it suits this person, in the brief's terms. Empty for a dish picked from the menu by hand. */
  why: string;
  /** e.g. "sauce on the side"; null when it's fine as it comes. */
  lighterTweak: string | null;
};

export type MenuAvoid = { diner: string; item: number; dish: string; why: string };

/** One line of the streamed answer (`Accept: application/x-ndjson`). */
export type MenuPickEvent =
  | { type: "stage"; text: string }
  | { type: "fact"; text: string }
  | { type: "dish"; name: string }
  | { type: "menu"; menu: ReadMenu }
  | { type: "pick"; pick: MenuPick }
  | { type: "avoid"; avoid: MenuAvoid }
  | { type: "done"; date: string; note: string | null }
  | { type: "error"; message: string };
