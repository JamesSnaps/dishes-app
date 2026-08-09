export interface ParsedIngredient {
  ingredientName: string;
  amount: string;
  unit: string;
  preparation: string;
  isOptional: boolean;
  groupLabel: string;
}

export interface ParsedStep {
  instruction: string;
  durationMinutes: string;
  timerLabel: string;
  groupLabel: string;
}

// Ordered longest-first so multi-word units match before shorter prefixes
const UNITS: string[] = [
  "fl oz", "fl. oz",
  "tablespoons", "tablespoon",
  "teaspoons", "teaspoon",
  "kilograms", "kilogram",
  "milligrams", "milligram",
  "millilitres", "milliliters", "millilitre", "milliliter",
  "litres", "liters", "litre", "liter",
  "ounces", "ounce",
  "pounds", "pound",
  "gallons", "gallon",
  "quarts", "quart",
  "pints", "pint",
  "pinches", "pinch",
  "dashes", "dash",
  "handfuls", "handful",
  "bunches", "bunch",
  "sprigs", "sprig",
  "cloves", "clove",
  "heads", "head",
  "slices", "slice",
  "sheets", "sheet",
  "sticks", "stick",
  "pieces", "piece",
  "sachets", "sachet",
  "packets", "packet",
  "bottles", "bottle",
  "cans", "can",
  "jars", "jar",
  "bags", "bag",
  "boxes", "box",
  "tins", "tin",
  "cups", "cup",
  "tbsp", "tsp",
  "kg", "mg", "ml", "dl",
  "lb", "lbs", "oz",
  "pt", "qt", "gl",
  "g", "l",
  "c", "t",
];

// Amount: mixed fraction (1 1/2), fraction (1/2), decimal (2.5), integer (3)
const AMOUNT_RE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*/;

// Words that, at the start of a line, mark it as a method instruction rather
// than an ingredient. Deliberately excludes weak prepositions ("to", "in") so
// that lines like "Salt and pepper to taste" stay ingredients.
const INSTRUCTION_CUES = new Set([
  "add", "allow", "arrange", "bake", "beat", "blend", "boil", "bring", "brush",
  "chill", "chop", "churn", "combine", "continue", "cook", "cover", "cut",
  "discard", "divide", "drain", "drizzle", "dust", "finally", "fold", "freeze",
  "fry", "garnish", "grease", "grill", "heat", "knead", "leave", "let", "line",
  "meanwhile", "mix", "next", "once", "place", "pour", "preheat", "process",
  "pulse", "reduce", "refrigerate", "remove", "repeat", "return", "roast",
  "scoop", "seal", "season", "serve", "set", "sift", "simmer", "slice",
  "spoon", "spread", "sprinkle", "stir", "strain", "then", "top", "toss",
  "transfer", "turn", "warm", "when", "whisk", "while", "wrap",
]);

/**
 * Heuristic: does this line read like a method instruction? Used to keep prose
 * out of the ingredient list when someone pastes a whole recipe into the
 * ingredients box.
 */
export function looksLikeInstruction(line: string): boolean {
  const cleaned = line
    .trim()
    .replace(/^[-–•*·]\s*/, "")
    .replace(/^(?:step\s*)?\d+\s*[.):\-–]\s*/i, "");
  if (!cleaned) return false;

  const words = cleaned.split(/\s+/);
  const first = words[0].toLowerCase().replace(/[^a-z]/g, "");

  if (INSTRUCTION_CUES.has(first)) return true;

  // More than one sentence on the line is prose, not an ingredient
  if (/[.!?]\s+[A-Z]/.test(cleaned)) return true;

  // Long lines without a leading amount are almost always instructions
  if (words.length >= 12 && !AMOUNT_RE.test(cleaned)) return true;

  return false;
}

export function parseIngredientLine(line: string): ParsedIngredient | null {
  line = line.trim();
  if (!line) return null;

  // Strip bullet/list prefixes
  line = line.replace(/^[-–•*·]\s*/, "");

  const isOptional =
    /\(\s*optional\s*\)/i.test(line) || /^optional[:\s]/i.test(line);
  line = line.replace(/\s*\(\s*optional\s*\)/gi, "").trim();

  let amount = "";
  let unit = "";
  let rest = line;

  const amountMatch = rest.match(AMOUNT_RE);
  if (amountMatch) {
    amount = amountMatch[1].trim();
    rest = rest.slice(amountMatch[0].length);

    for (const u of UNITS) {
      // Escape dots, require word boundary after unit
      const pattern = new RegExp(
        `^${u.replace(/\./g, "\\.")}(?=[\\s,.]|$)`,
        "i"
      );
      const m = rest.match(pattern);
      if (m) {
        unit = m[0].toLowerCase();
        rest = rest.slice(m[0].length).trim();
        break;
      }
    }
  }

  // Split on first comma: left = name, right = preparation
  const commaIdx = rest.indexOf(",");
  let ingredientName: string;
  let preparation = "";

  if (commaIdx !== -1) {
    ingredientName = rest.slice(0, commaIdx).trim();
    preparation = rest.slice(commaIdx + 1).trim();
  } else {
    ingredientName = rest.trim();
  }

  if (!ingredientName) return null;

  return { ingredientName, amount, unit, preparation, isOptional, groupLabel: "" };
}

export function parseIngredientsText(text: string): ParsedIngredient[] {
  return splitIngredientsText(text).ingredients;
}

/**
 * Parse an ingredients paste, separating out any method prose that was pasted
 * along with it. `leftoverText` holds the lines that looked like instructions.
 */
export function splitIngredientsText(text: string): {
  ingredients: ParsedIngredient[];
  leftoverText: string;
} {
  const lines = text.split("\n");
  const results: ParsedIngredient[] = [];
  const leftover: string[] = [];
  let currentGroup = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (looksLikeInstruction(line)) {
      leftover.push(line);
      continue;
    }

    // Group header: a line ending in ":" that doesn't start with a digit/bullet
    // and doesn't parse as an ingredient with an amount
    if (
      /^[^\d•\-*].*:$/.test(line) &&
      !AMOUNT_RE.test(line.replace(/^[-–•*·]\s*/, ""))
    ) {
      currentGroup = line.replace(/:$/, "").trim();
      continue;
    }

    const parsed = parseIngredientLine(line);
    if (parsed) {
      parsed.groupLabel = currentGroup;
      results.push(parsed);
    }
  }

  return { ingredients: results, leftoverText: leftover.join("\n") };
}

export function parseStepsText(text: string): ParsedStep[] {
  const toStep = (s: string): ParsedStep => ({
    instruction: s.replace(/\s+/g, " ").trim(),
    durationMinutes: "",
    timerLabel: "",
    groupLabel: "",
  });

  // Numbered list: "1.", "1)", "Step 1:", "Step 1 -"
  const numberedRe = /(?:^|\n)\s*(?:step\s*)?\d+[.):\-–]\s*/gi;
  if (numberedRe.test(text)) {
    return text
      .split(/\n?\s*(?:step\s*)?\d+[.):\-–]\s*/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(toStep);
  }

  // Bullet list
  const bulletRe = /^[-–•*]\s+/m;
  if (bulletRe.test(text)) {
    return text
      .split(/\n(?=[-–•*]\s)/)
      .map((s) => s.replace(/^[-–•*]\s+/, "").trim())
      .filter(Boolean)
      .map(toStep);
  }

  // Double-newline paragraphs
  const paragraphs = text.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    return paragraphs.map(toStep);
  }

  // Single newlines
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(toStep);
}
