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
  const lines = text.split("\n");
  const results: ParsedIngredient[] = [];
  let currentGroup = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

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

  return results;
}

export function parseStepsText(text: string): ParsedStep[] {
  const toStep = (s: string): ParsedStep => ({
    instruction: s.replace(/\s+/g, " ").trim(),
    durationMinutes: "",
    timerLabel: "",
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
