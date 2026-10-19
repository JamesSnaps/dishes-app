/**
 * Autocomplete for the shopping list's add field, built entirely from data
 * already on the device: every shopping item the household has had (the sync
 * store holds all lists, archived ones included) and the ingredient names in
 * its recipes. No request per keystroke, and it works with no signal.
 *
 * The native app ranks the same way — DishesCore/Models/ShoppingSuggestions.swift.
 * Change a rule here and there together.
 */

export type ShoppingSuggestion = {
  /** As it was last written on a list (or in a recipe). */
  name: string;
  /** "history": on a list before. "recipe": only in a recipe so far. */
  source: "history" | "recipe";
  /** Times on a list, or the number of recipes using it. */
  count: number;
  /** The aisle it was last filed under, so picking it lands it there again. */
  category: string | null;
};

type IndexEntry = ShoppingSuggestion & {
  /** suggestionKey(name): what makes two rows the same item. */
  key: string;
  /** The name lower-cased, for matching as typed. */
  text: string;
  score: number;
  newest: number;
};

export type SuggestionIndex = { entries: IndexEntry[] };

/** Shopping items (ingredientName, category, createdAt) and recipes (ingredients), as stored. */
type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;
/** A list from two months ago counts half as much as one from today. */
const HALF_LIFE_DAYS = 60;
export const MAX_SUGGESTIONS = 6;

function lower(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Case, spacing and a trailing plural "s" don't make a different item. */
export function suggestionKey(name: string): string {
  const k = lower(name);
  return k.length > 3 && k.endsWith("s") && !k.endsWith("ss") ? k.slice(0, -1) : k;
}

function timeOf(value: unknown): number | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * One pass over the local data. Built once per change to it, not per keystroke.
 * `history` rows are shopping items; the newest decides a name's spelling and
 * category, and each one adds to its score, decayed by age.
 */
export function buildSuggestionIndex(
  history: Row[],
  recipes: Row[],
  now = Date.now()
): SuggestionIndex {
  const byKey = new Map<string, IndexEntry>();

  for (const row of history) {
    if (typeof row.ingredientName !== "string") continue;
    const name = row.ingredientName.trim();
    if (!name) continue;
    const key = suggestionKey(name);
    // An item added here that hasn't synced yet has no date: it's from now.
    const at = timeOf(row.createdAt) ?? now;
    const weight = Math.pow(0.5, Math.max(0, now - at) / DAY_MS / HALF_LIFE_DAYS);
    const category =
      typeof row.category === "string" && row.category ? row.category : null;

    const entry = byKey.get(key);
    if (!entry) {
      byKey.set(key, { key, text: lower(name), name, source: "history", count: 1, category, score: weight, newest: at });
      continue;
    }
    entry.count++;
    entry.score += weight;
    if (at >= entry.newest) {
      entry.newest = at;
      entry.name = name;
      entry.text = lower(name);
      if (category) entry.category = category;
    } else if (!entry.category) {
      entry.category = category;
    }
  }

  for (const recipe of recipes) {
    if (!Array.isArray(recipe.ingredients)) continue;
    // A recipe that lists "salt" twice still only uses it once.
    const seen = new Set<string>();
    for (const ing of recipe.ingredients as { ingredientName?: unknown }[]) {
      if (typeof ing?.ingredientName !== "string") continue;
      const name = ing.ingredientName.trim();
      if (!name) continue;
      const key = suggestionKey(name);
      if (seen.has(key)) continue;
      seen.add(key);

      const entry = byKey.get(key);
      if (entry) {
        if (entry.source === "recipe") entry.count++;
        continue;
      }
      byKey.set(key, { key, text: lower(name), name, source: "recipe", count: 1, category: null, score: 0, newest: 0 });
    }
  }

  return { entries: [...byKey.values()] };
}

/** Where the query matched: the start of the name, the start of a word, anywhere. */
function matchTier(key: string, query: string): number | null {
  if (key.startsWith(query)) return 0;
  if (key.includes(" " + query)) return 1;
  // One letter matching mid-word is noise ("a" is in nearly everything).
  if (query.length >= 2 && key.includes(query)) return 2;
  return null;
}

/**
 * The best few matches for what's been typed. Things bought before come ahead
 * of things only seen in recipes, and among those the most bought (recently)
 * first. `exclude` is keys already unticked on the list — no point offering them.
 */
export function suggestShoppingItems(
  index: SuggestionIndex,
  typed: string,
  exclude: Set<string> = new Set(),
  limit = MAX_SUGGESTIONS
): ShoppingSuggestion[] {
  const query = lower(typed);
  if (!query) return [];
  const exact = suggestionKey(typed);

  const matches: { entry: IndexEntry; tier: number }[] = [];
  for (const entry of index.entries) {
    if (exclude.has(entry.key)) continue;
    // Exactly what was typed goes first, plural or not ("eggs" finds "Egg"):
    // picking it is the same as pressing Enter, but it brings back the aisle.
    const tier = entry.key === exact ? -1 : matchTier(entry.text, query);
    if (tier === null) continue;
    matches.push({ entry, tier });
  }

  matches.sort(
    (a, b) =>
      a.tier - b.tier ||
      (a.entry.source === b.entry.source ? 0 : a.entry.source === "history" ? -1 : 1) ||
      b.entry.score - a.entry.score ||
      b.entry.count - a.entry.count ||
      a.entry.name.localeCompare(b.entry.name)
  );

  return matches.slice(0, limit).map(({ entry }) => ({
    name: entry.name,
    source: entry.source,
    count: entry.count,
    category: entry.category,
  }));
}
