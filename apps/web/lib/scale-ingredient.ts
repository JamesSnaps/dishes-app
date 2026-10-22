// Ingredient amount scaling shared by cooking mode and the recipe view.
// Handles mixed fractions ("1 1/2"), simple fractions ("1/2"), and decimals,
// rendering scaled amounts back to nice unicode fractions where possible.

// Nice fractions to render a scaled amount with, by value. Matched within a
// tolerance rather than by a formatted key: 0.5.toFixed(2) is "0.50", which a
// "0.5" key never matched, so halves and fifths used to come out as decimals.
const FRACTION_SYMBOLS: [number, string][] = [
  [1 / 8, "⅛"],
  [1 / 5, "⅕"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [2 / 5, "⅖"],
  [1 / 2, "½"],
  [3 / 5, "⅗"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [4 / 5, "⅘"],
  [7 / 8, "⅞"],
];

// Unicode vulgar fractions people (and AI) type into amounts: "½", "1½".
const UNICODE_FRACTIONS: Record<string, number> = {
  "⅛": 1 / 8, "⅕": 1 / 5, "¼": 1 / 4, "⅓": 1 / 3, "⅜": 3 / 8, "⅖": 2 / 5,
  "½": 1 / 2, "⅗": 3 / 5, "⅝": 5 / 8, "⅔": 2 / 3, "¾": 3 / 4, "⅘": 4 / 5,
  "⅞": 7 / 8,
};

// Handles "1 1/2", "1/2", "1", "1.5", "½" and "1½"
export function parseMixedFraction(amount: string): number {
  const trimmed = amount.trim();
  const unicodeMatch = trimmed.match(/^(\d+)?\s*([⅛⅕¼⅓⅜⅖½⅗⅝⅔¾⅘⅞])$/);
  if (unicodeMatch)
    return parseInt(unicodeMatch[1] ?? "0") + UNICODE_FRACTIONS[unicodeMatch[2]!]!;
  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch)
    return parseInt(mixedMatch[1]!) + parseInt(mixedMatch[2]!) / parseInt(mixedMatch[3]!);
  const fracMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) return parseInt(fracMatch[1]!) / parseInt(fracMatch[2]!);
  return parseFloat(trimmed);
}

/**
 * The numeric value of a stored ingredient amount, or NaN when it has none
 * ("a pinch", null). Use this, never parseFloat: amounts are stored as typed,
 * and parseFloat("1/2") and parseFloat("1 1/2") are both 1.
 */
export function parseAmount(amount: string | null | undefined): number {
  if (amount == null || amount.trim() === "") return NaN;
  return parseMixedFraction(amount);
}

// A range like "2-3" or "2–3", scaled end to end.
const RANGE_RE = /^(.+?)\s*[-–]\s*(.+)$/;

// Scale a single amount string by `scale`. Non-numeric amounts (e.g. "a pinch")
// are returned unchanged so they still render sensibly.
export function scaleAmount(amount: string | null, scale: number): string {
  if (!amount) return "";
  const range = amount.trim().match(RANGE_RE);
  if (range && !isNaN(parseMixedFraction(range[1]!)) && !isNaN(parseMixedFraction(range[2]!)))
    return `${scaleAmount(range[1]!, scale)}–${scaleAmount(range[2]!, scale)}`;
  const raw = parseMixedFraction(amount);
  if (isNaN(raw)) return amount;
  const scaled = raw * scale;
  const whole = Math.floor(scaled);
  const frac = scaled - whole;
  if (frac < 0.01) return String(whole || "");
  if (frac > 0.99) return String(whole + 1);
  const fracSymbol = FRACTION_SYMBOLS.find(([value]) => Math.abs(frac - value) < 0.01)?.[1] ?? null;
  if (whole === 0) return fracSymbol ?? parseFloat(scaled.toFixed(2)).toString();
  return fracSymbol ? `${whole}${fracSymbol}` : parseFloat(scaled.toFixed(2)).toString();
}

// Scale factor from the recipe's base servings to the desired servings.
// Falls back to 1 when base servings are missing or invalid.
export function servingsScale(
  baseServings: number | null | undefined,
  desiredServings: number | null | undefined
): number {
  if (!baseServings || !desiredServings || baseServings <= 0 || desiredServings <= 0)
    return 1;
  return desiredServings / baseServings;
}
