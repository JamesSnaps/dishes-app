/**
 * Reading a recipe out of a web page's HTML.
 *
 * Most recipe sites publish the recipe as schema.org `Recipe` JSON-LD — Google
 * needs it for recipe rich results, so WordPress recipe plugins, the BBC,
 * supermarkets and veg-box sites all emit it. That is read here, without AI,
 * into the same flat shape the recipe form takes. Pages without it fall back to
 * `pageText`, which the server action can hand to the household's AI.
 *
 * Pure: no network, no database. `scripts/check-recipe-web-import.ts` holds
 * the fixtures.
 */

import { MEAL_TYPES } from "@dishes/shared";
import type { RecipeFormDefaults } from "@/app/(app)/recipes/_components/recipe-form";
import {
  parseIngredientLine,
  parseStepsText,
  type ParsedIngredient,
  type ParsedStep,
} from "@/lib/recipe-parser";

export type WebRecipe = {
  title: string;
  description: string;
  cuisine: string;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: string;
  servingsUnit: string;
  mealRole: "main" | "side" | "sauce" | "other" | null;
  mealTypes: string[];
  tags: string[];
  /** The lines exactly as the site wrote them, for the AI tidy-up pass. */
  rawIngredients: string[];
  ingredients: ParsedIngredient[];
  steps: ParsedStep[];
  nutrition: {
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    saturatedFatG: number | null;
    fiberG: number | null;
    sugarG: number | null;
    sodiumMg: number | null;
  } | null;
};

/** What `importRecipeFromUrl` hands the new-recipe form. */
export type WebImportResult = {
  draft?: RecipeFormDefaults;
  /** How the recipe was read: the page's recipe data, tidied by AI, or AI alone. */
  via?: "recipe-data" | "recipe-data+ai" | "ai";
  /** Something the cook should know, e.g. the photo couldn't be copied. */
  notice?: string;
  error?: string;
};

export type PageExtraction = {
  /** The schema.org recipe, when the page has a usable one. */
  recipe: WebRecipe | null;
  /** Image URLs to try, best first (recipe image, then og:image). Absolute. */
  imageUrls: string[];
  /** Page title from og:title / <title>, for the AI fallback. */
  pageTitle: string;
  /** The readable text of the page, for the AI fallback. */
  pageText: string;
  /**
   * A schema.org Recipe too incomplete to use on its own (no method, say), as
   * JSON — still useful context for the AI fallback, especially on app-style
   * pages with little readable text.
   */
  partialRecipeJson: string | null;
};

// ── Text helpers ──────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–",
  mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  deg: "°", frac12: "½", frac14: "¼", frac34: "¾", frac13: "⅓", frac23: "⅔",
  times: "×", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", uuml: "ü",
  ouml: "ö", auml: "ä", ntilde: "ñ", pound: "£", euro: "€", copy: "©", reg: "®",
  trade: "™", middot: "·", bull: "•",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** HTML fragment → one line of plain text. Sites put markup inside JSON-LD strings. */
export function cleanText(s: unknown): string {
  if (typeof s !== "string") return "";
  // Decode first: some sites double-encode, so `&lt;b&gt;` becomes a tag here.
  const decoded = decodeEntities(decodeEntities(s));
  return decoded
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const VULGAR_FRACTIONS: Record<string, string> = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅕": "1/5",
  "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6", "⅛": "1/8",
  "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

/** "1½ tsp" → "1 1/2 tsp", so the ingredient parser's amount pattern sees it. */
export function normaliseFractions(s: string): string {
  return s
    .replace(/(\d)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_, d: string, f: string) => `${d} ${VULGAR_FRACTIONS[f]}`)
    .replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (f) => VULGAR_FRACTIONS[f]!)
    .replace(/(\d)⁄(\d)/g, "$1/$2");
}

function asArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function firstString(v: unknown): string {
  for (const item of asArray(v)) {
    const s = cleanText(typeof item === "object" && item ? (item as Record<string, unknown>).name : item);
    if (s) return s;
  }
  return "";
}

// ── Field parsers ─────────────────────────────────────────────────────────────

/** ISO 8601 duration ("PT1H30M", "P0DT0H20M") or loose text ("20 mins") → minutes. */
export function parseDurationMinutes(v: unknown): number | null {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (!s) return null;

  const iso = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso) {
    const [, d, h, m, sec] = iso;
    const total = Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0) + Number(sec ?? 0) / 60;
    return total > 0 ? Math.round(total) : null;
  }

  const hours = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i);
  const mins = s.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  if (hours || mins) {
    const total = Number(hours?.[1] ?? 0) * 60 + Number(mins?.[1] ?? 0);
    return total > 0 ? Math.round(total) : null;
  }
  if (/^\d+$/.test(s)) return Number(s) || null;
  return null;
}

/** recipeYield ("4", 4, ["4", "4 servings"], "Serves 4-6", "12 cookies") → servings + unit. */
export function parseYield(v: unknown): { servings: string; servingsUnit: string } {
  const candidates = asArray(v).map((x) => cleanText(typeof x === "number" ? String(x) : x)).filter(Boolean);
  // Prefer the entry that names its unit ("4 servings" over "4").
  const text = candidates.find((c) => /\d\s*[a-z]/i.test(c)) ?? candidates[0] ?? "";
  const num = text.match(/(\d+(?:\.\d+)?)/);
  if (!num) return { servings: "", servingsUnit: "servings" };

  const after = text.slice((num.index ?? 0) + num[0].length).replace(/^\s*[-–to]+\s*\d+(?:\.\d+)?/i, "");
  const word = after.match(/^\s*([a-z]+)/i)?.[1]?.toLowerCase();
  const generic = new Set(["serving", "servings", "people", "person", "persons", "adults", "x"]);
  const servingsUnit = word && !generic.has(word) && word.length <= 20 ? word : "servings";
  return { servings: num[1]!, servingsUnit };
}

function parseNumber(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
  const m = s.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parseNutrition(v: unknown): WebRecipe["nutrition"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const n = v as Record<string, unknown>;
  const sodiumRaw = typeof n.sodiumContent === "string" ? n.sodiumContent : "";
  let sodiumMg = parseNumber(n.sodiumContent);
  // "0.5 g" of sodium is 500 mg; a bare number or "mg" is already mg.
  if (sodiumMg !== null && /\d\s*g\b/i.test(sodiumRaw) && !/mg/i.test(sodiumRaw)) sodiumMg *= 1000;

  const out = {
    calories: parseNumber(n.calories),
    proteinG: parseNumber(n.proteinContent),
    carbsG: parseNumber(n.carbohydrateContent),
    fatG: parseNumber(n.fatContent),
    saturatedFatG: parseNumber(n.saturatedFatContent),
    fiberG: parseNumber(n.fiberContent),
    sugarG: parseNumber(n.sugarContent),
    sodiumMg: sodiumMg === null ? null : Math.round(sodiumMg),
  };
  return Object.values(out).some((x) => x !== null) ? out : null;
}

// Category words that say what meal a dish is (they become mealTypes) or how
// hard it is — not worth repeating as tags.
const NON_TAG_WORDS = new Set([
  ...MEAL_TYPES, "main", "main course", "mains", "side", "side dish", "supper",
  "easy", "medium", "hard", "recipe", "recipes",
]);

/** Keywords (or, failing those, categories) as tags — a handful, deduplicated. */
function parseTags(keywords: unknown, category: unknown, cuisine: string): string[] {
  const split = (v: unknown) => asArray(v).flatMap((k) => cleanText(k).split(","));
  const fromKeywords = split(keywords);
  const raw = fromKeywords.length ? fromKeywords : split(category);
  const seen = new Set<string>([cuisine.toLowerCase(), ...NON_TAG_WORDS]);
  const tags: string[] = [];
  for (const t of raw.map((s) => s.trim())) {
    const key = t.toLowerCase();
    if (!t || t.length > 30 || seen.has(key)) continue;
    seen.add(key);
    tags.push(t);
  }
  return tags.slice(0, 8);
}

function parseMealTypes(category: unknown, keywords: unknown): string[] {
  const words = [...asArray(category), ...asArray(keywords)]
    .map((c) => cleanText(c).toLowerCase())
    .join(" ");
  const found = new Set<string>();
  for (const meal of MEAL_TYPES) if (words.includes(meal)) found.add(meal);
  if (/\b(supper|main course|mains)\b/.test(words)) found.add("dinner");
  if (/\b(pudding|desserts|cake|cakes)\b/.test(words)) found.add("dessert");
  if (/\b(brunch)\b/.test(words)) found.add("breakfast");
  if (/\b(snacks)\b/.test(words)) found.add("snack");
  return MEAL_TYPES.filter((m) => found.has(m));
}

function parseMealRole(category: unknown): WebRecipe["mealRole"] {
  const words = asArray(category).map((c) => cleanText(c).toLowerCase()).join(" ");
  if (/\bmain/.test(words)) return "main";
  if (/\bside/.test(words)) return "side";
  if (/\b(sauce|dressing|condiment|gravy)/.test(words)) return "sauce";
  return null;
}

/**
 * recipeInstructions comes as: one string (often HTML), an array of strings, an
 * array of HowToStep, or HowToSection(s) whose `itemListElement` holds the steps.
 * Section names become step groups, matching the form's sections.
 */
export function parseInstructions(v: unknown): ParsedStep[] {
  const steps: ParsedStep[] = [];

  const pushText = (text: string, groupLabel: string) => {
    const t = cleanText(text);
    if (t) steps.push({ instruction: t, durationMinutes: "", timerLabel: "", groupLabel });
  };

  const walk = (node: unknown, groupLabel: string) => {
    if (typeof node === "string") {
      // A single string may be the whole method; split it like a paste.
      let asText = decodeEntities(node)
        .replace(/<\/(p|li|div)>|<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .trim();
      // One run-on string whose steps were joined without a space
      // ("…greaseproof paper.Snap the chocolate…"): split at those joins.
      if (!asText.includes("\n")) asText = asText.replace(/([.!?])(?=[A-Z])/g, "$1\n");
      for (const s of parseStepsText(asText)) pushText(s.instruction, groupLabel);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, groupLabel);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const types = asArray(obj["@type"]).map(String);

    if (types.includes("HowToSection") || (obj.itemListElement && !obj.text)) {
      walk(obj.itemListElement, cleanText(obj.name) || groupLabel);
      return;
    }
    // HowToStep: `text` is the instruction; `name` is often just its first words.
    const text = typeof obj.text === "string" ? obj.text : typeof obj.name === "string" ? obj.name : "";
    if (text) pushText(text, groupLabel);
  };

  walk(v, "");
  return steps;
}

/**
 * Ingredient lines → structured rows. Lines that are really section headings
 * ("For the sauce:") become the group label of the lines that follow.
 */
export function parseIngredientLines(lines: string[]): ParsedIngredient[] {
  const out: ParsedIngredient[] = [];
  let group = "";
  for (const raw of lines) {
    const line = normaliseFractions(raw)
      // UK sites print both systems: "100g/3 1/2oz butter" → "100g butter".
      .replace(
        /^(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cm))\s*\/(?:\s*[\d\s/.]+\s*(?:fl\.?\s?oz|oz|lbs?|pints?|pt|cups?|in)\b)+/i,
        "$1"
      );
    const heading = line.match(/^(?:for\s+the\s+)?(.{2,40}?):$/i);
    if (heading && !/\d/.test(line)) {
      group = line.replace(/:$/, "").trim();
      continue;
    }
    // A range ("1-2 lemons", "3 to 4 tbsp oil") keeps both ends as the amount.
    const range = line.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?=\D)/i);
    const parsed = range
      ? parseIngredientLine(`1 ${line.slice(range[0].length)}`)
      : parseIngredientLine(line);
    if (!parsed) continue;
    if (range) parsed.amount = `${range[1]}-${range[2]}`;
    // "2 x 400g tins chopped tomatoes": two of the "400g tins…".
    parsed.ingredientName = parsed.ingredientName.replace(/^x\s+/i, "");
    out.push({ ...parsed, groupLabel: group });
  }
  return out;
}

// ── HTML scanning ─────────────────────────────────────────────────────────────

function parseJsonLoose(raw: string): unknown {
  const text = raw.trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
  try {
    return JSON.parse(text);
  } catch {
    // Raw newlines/tabs inside strings are a common hand-written-JSON slip.
    try {
      return JSON.parse(text.replace(/[\u0000-\u001F]+/g, " "));
    } catch {
      return null;
    }
  }
}

function isRecipeNode(node: Record<string, unknown>): boolean {
  return asArray(node["@type"]).some((t) => typeof t === "string" && /(^|\/)Recipe$/i.test(t));
}

/** Depth-first search through JSON-LD (arrays, @graph, mainEntity…) for a Recipe. */
export function findRecipeNode(data: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 8 || data == null || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = data as Record<string, unknown>;
  if (isRecipeNode(obj)) return obj;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    const found = findRecipeNode(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** Like `findRecipeNode`, but through every key — for framework app state. */
function findRecipeNodeDeep(data: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 14 || data == null || typeof data !== "object") return null;
  if (!Array.isArray(data) && isRecipeNode(data as Record<string, unknown>)) {
    return data as Record<string, unknown>;
  }
  for (const value of Array.isArray(data) ? data : Object.values(data)) {
    const found = findRecipeNodeDeep(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Single-page apps (Next.js, Nuxt, Inertia) often carry the schema.org recipe
 * inside their serialised page state rather than a JSON-LD script.
 */
function appStateBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const scripts =
    /<script\b[^>]*(?:id\s*=\s*["'](?:__NEXT_DATA__|__NUXT_DATA__)["']|type\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(scripts)) {
    const parsed = parseJsonLoose(m[1]!);
    if (parsed) blocks.push(parsed);
  }
  for (const m of html.matchAll(/\bdata-page\s*=\s*"([^"]*)"/gi)) {
    const parsed = parseJsonLoose(decodeEntities(m[1]!));
    if (parsed) blocks.push(parsed);
  }
  return blocks;
}

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const parsed = parseJsonLoose(m[1]!);
    if (parsed) blocks.push(parsed);
  }
  return blocks;
}

/** <meta property|name="key" content="…"> values, keyed lower-case. */
function metaTags(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i);
    const value = content?.[1] ?? content?.[2];
    if (key && value && !out.has(key)) out.set(key, decodeEntities(value).trim());
  }
  return out;
}

function imageUrlsOf(v: unknown): string[] {
  return asArray(v)
    .map((img) => {
      if (typeof img === "string") return img;
      if (img && typeof img === "object") {
        const o = img as Record<string, unknown>;
        return typeof o.url === "string" ? o.url : typeof o.contentUrl === "string" ? o.contentUrl : "";
      }
      return "";
    })
    .filter(Boolean);
}

/** An attribute's value from one tag's source, decoded. */
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  const value = m?.[1] ?? m?.[2];
  return value === undefined ? undefined : decodeEntities(value).trim();
}

/** The widest entry of a srcset ("a.jpg 400w, b.jpg 1200w" → b.jpg). */
export function largestFromSrcset(srcset: string): string | undefined {
  let best: { url: string; size: number } | undefined;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, descriptor = "1x"] = part.trim().split(/\s+/);
    if (!url) continue;
    const size = parseFloat(descriptor) * (descriptor.endsWith("x") ? 1000 : 1);
    if (!best || size > best.size) best = { url, size };
  }
  return best?.url;
}

const NOT_A_PHOTO =
  /\.svg(\?|$)|^data:|(^|[\W_])(logos?|icons?|sprites?|avatars?|badges?|pixel|placeholder|spinner|payments?|flags?|portraits?|headshots?|authors?|profiles?|byline)([\W_]|$)/i;

/**
 * Where else a page keeps its photo when it has no og:image or recipe image:
 * itemprop/thumbnail/image_src tags, then the first real-looking <img> in the
 * main content (lazy-loading attributes included; logos and icons skipped).
 */
export function fallbackImageUrls(html: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
    const tag = m[0];
    const itemprop = attr(tag, "itemprop")?.toLowerCase();
    const name = attr(tag, "name")?.toLowerCase();
    const rel = attr(tag, "rel")?.toLowerCase();
    const property = attr(tag, "property")?.toLowerCase();
    if (itemprop === "image" || name === "image" || property === "image" || name === "thumbnail") {
      urls.push(attr(tag, "content") ?? attr(tag, "href") ?? "");
    }
    if (rel === "image_src") urls.push(attr(tag, "href") ?? "");
  }

  // <video>/<audio> <source>s are media files, not photos.
  const body = html.replace(/<(script|style|noscript|svg|template|head|header|nav|footer|video|audio)\b[\s\S]*?<\/\1>/gi, " ");
  const region =
    body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    body;
  const photos = (fragment: string) => {
    const out: string[] = [];
    for (const m of fragment.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
      if (out.length >= 3) break;
      const tag = m[0];
      const width = Number(attr(tag, "width") ?? 0);
      if (width > 0 && width < 200) continue;
      const srcset = attr(tag, "data-srcset") || attr(tag, "srcset");
      // A <picture> <source> always has a srcset; one with only src is media.
      if (/^<source/i.test(tag) && !srcset) continue;
      const src =
        (srcset && largestFromSrcset(srcset)) ||
        attr(tag, "data-src") || attr(tag, "data-lazy-src") || attr(tag, "data-original") || attr(tag, "src");
      const label = `${attr(tag, "alt") ?? ""} ${attr(tag, "class") ?? ""}`;
      if (!src || NOT_A_PHOTO.test(src) || NOT_A_PHOTO.test(label) || /\.(mp4|webm|mov|m3u8|mp3)(\?|$)/i.test(src)) continue;
      out.push(src);
    }
    return out;
  };
  // The hero photo often sits just above <main>, so try the whole page too.
  const inRegion = photos(region);
  urls.push(...(inRegion.length ? inRegion : photos(body)));
  return urls.filter(Boolean);
}

function absolute(url: string, base: string): string | null {
  try {
    const u = new URL(decodeEntities(url.trim()), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The readable text of a page — the main/article region when it has one. */
export function extractPageText(html: string, maxChars = 20_000): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ");

  const toText = (fragment: string) =>
    decodeEntities(
      fragment
        .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/tr|\/section)\b[^>]*>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "\n• ")
        .replace(/<[^>]+>/g, " ")
    )
      .replace(/[ \t ]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const region =
    body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  let text = region ? toText(region) : "";
  if (text.length <= 500) {
    // Without a main region, drop the page chrome — unless that takes the
    // content with it (some sites wrap the whole page in a <header> or <form>).
    const withoutChrome = toText(body.replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, " "));
    text = withoutChrome.length > 500 ? withoutChrome : toText(body);
  }

  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function mapSchemaRecipe(node: Record<string, unknown>): WebRecipe | null {
  const title = cleanText(node.name) || cleanText(node.headline);
  // Some sites pack several lines into one string, separated by newlines.
  const rawIngredients = asArray(node.recipeIngredient ?? node.ingredients)
    .flatMap((i) => (typeof i === "string" ? decodeEntities(i).split(/\r?\n|<br\s*\/?>/i) : []))
    .map(cleanText)
    .filter(Boolean);
  const steps = parseInstructions(node.recipeInstructions);
  // Some sites emit a stub Recipe (name and image only, or a lone "Chicken"
  // for the ingredient list). That's not worth pre-filling from — let the AI
  // read the page instead.
  if (!title || rawIngredients.length < 2 || steps.length === 0) return null;

  const cuisine = firstString(node.recipeCuisine);
  const prep = parseDurationMinutes(node.prepTime);
  const cook = parseDurationMinutes(node.cookTime);
  const total = parseDurationMinutes(node.totalTime);
  const { servings, servingsUnit } = parseYield(node.recipeYield);

  return {
    title,
    description: cleanText(node.description),
    cuisine,
    prepTimeMinutes: prep,
    // Only a total? Count it as cooking time rather than lose it.
    cookTimeMinutes: cook ?? (prep === null ? total : total !== null && total > prep ? total - prep : null),
    servings,
    servingsUnit,
    mealRole: parseMealRole(node.recipeCategory),
    mealTypes: parseMealTypes(node.recipeCategory, node.keywords),
    tags: parseTags(node.keywords, node.recipeCategory, cuisine),
    rawIngredients,
    ingredients: parseIngredientLines(rawIngredients),
    steps,
    nutrition: parseNutrition(node.nutrition),
  };
}

export function extractRecipeFromHtml(html: string, pageUrl: string): PageExtraction {
  let node: Record<string, unknown> | null = null;
  for (const block of jsonLdBlocks(html)) {
    node = findRecipeNode(block);
    if (node) break;
  }
  if (!node) {
    for (const block of appStateBlocks(html)) {
      node = findRecipeNodeDeep(block);
      if (node) break;
    }
  }

  const meta = metaTags(html);
  const imageUrls = [
    ...(node ? imageUrlsOf(node.image) : []),
    meta.get("og:image:secure_url") ?? "",
    meta.get("og:image") ?? "",
    meta.get("twitter:image") ?? "",
    meta.get("twitter:image:src") ?? "",
    ...fallbackImageUrls(html),
  ]
    .map((u) => (u ? absolute(u, pageUrl) : null))
    .filter((u): u is string => !!u);

  const htmlTitle = cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");

  const recipe = node ? mapSchemaRecipe(node) : null;
  return {
    recipe,
    imageUrls: [...new Set(imageUrls)],
    pageTitle: meta.get("og:title") || htmlTitle,
    pageText: extractPageText(html),
    partialRecipeJson: node && !recipe ? JSON.stringify(node).slice(0, 12_000) : null,
  };
}

/** The deterministic read as form defaults — no AI involved. */
export function webRecipeToDefaults(r: WebRecipe): RecipeFormDefaults {
  const n = r.nutrition;
  const str = (v: number | null | undefined) => (v == null ? null : String(v));
  return {
    title: r.title,
    description: r.description,
    cuisine: r.cuisine,
    prepTimeMinutes: r.prepTimeMinutes,
    cookTimeMinutes: r.cookTimeMinutes,
    servings: r.servings || null,
    servingsUnit: r.servingsUnit,
    mealRole: r.mealRole,
    mealTypes: r.mealTypes,
    tags: r.tags,
    ingredients: r.ingredients,
    steps: r.steps,
    calories: n?.calories ?? null,
    proteinG: str(n?.proteinG),
    carbsG: str(n?.carbsG),
    fatG: str(n?.fatG),
    saturatedFatG: str(n?.saturatedFatG),
    fiberG: str(n?.fiberG),
    sugarG: str(n?.sugarG),
    sodiumMg: str(n?.sodiumMg),
  };
}

/** The site's recipe as plain text, for the AI tidy-up pass to restructure. */
export function webRecipeAsText(r: WebRecipe): string {
  const lines = [`Title: ${r.title}`];
  if (r.description) lines.push(`Description: ${r.description}`);
  if (r.cuisine) lines.push(`Cuisine: ${r.cuisine}`);
  if (r.servings) lines.push(`Yield: ${r.servings} ${r.servingsUnit}`);
  if (r.prepTimeMinutes) lines.push(`Prep time: ${r.prepTimeMinutes} minutes`);
  if (r.cookTimeMinutes) lines.push(`Cook time: ${r.cookTimeMinutes} minutes`);
  if (r.tags.length) lines.push(`Keywords: ${r.tags.join(", ")}`);
  lines.push("", "Ingredients:", ...r.rawIngredients.map((i) => `- ${i}`), "", "Method:");
  let group = "";
  r.steps.forEach((s, i) => {
    if (s.groupLabel && s.groupLabel !== group) lines.push(`[${s.groupLabel}]`);
    group = s.groupLabel;
    lines.push(`${i + 1}. ${s.instruction}`);
  });
  if (r.nutrition) {
    const n = r.nutrition;
    lines.push(
      "",
      `Published nutrition per serving: ${[
        n.calories != null && `${n.calories} kcal`,
        n.proteinG != null && `protein ${n.proteinG}g`,
        n.carbsG != null && `carbs ${n.carbsG}g`,
        n.fatG != null && `fat ${n.fatG}g`,
        n.saturatedFatG != null && `saturates ${n.saturatedFatG}g`,
        n.fiberG != null && `fibre ${n.fiberG}g`,
        n.sugarG != null && `sugar ${n.sugarG}g`,
        n.sodiumMg != null && `sodium ${n.sodiumMg}mg`,
      ]
        .filter(Boolean)
        .join(", ")}`
    );
  }
  return lines.join("\n");
}

/** Drop analytics parameters so the saved source link is the canonical page. */
export function cleanSourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|ref$|ref_src$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}
