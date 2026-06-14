// Ingredient amount scaling shared by cooking mode and the recipe view.
// Handles mixed fractions ("1 1/2"), simple fractions ("1/2"), and decimals,
// rendering scaled amounts back to nice unicode fractions where possible.

const FRACTION_SYMBOLS: Record<string, string> = {
  "0.25": "¼",
  "0.5": "½",
  "0.75": "¾",
  "0.33": "⅓",
  "0.67": "⅔",
  "0.2": "⅕",
  "0.4": "⅖",
  "0.6": "⅗",
  "0.8": "⅘",
  "0.125": "⅛",
  "0.375": "⅜",
  "0.625": "⅝",
  "0.875": "⅞",
};

// Handles "1 1/2", "1/2", "1", "1.5"
export function parseMixedFraction(amount: string): number {
  const trimmed = amount.trim();
  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch)
    return parseInt(mixedMatch[1]!) + parseInt(mixedMatch[2]!) / parseInt(mixedMatch[3]!);
  const fracMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) return parseInt(fracMatch[1]!) / parseInt(fracMatch[2]!);
  return parseFloat(trimmed);
}

// Scale a single amount string by `scale`. Non-numeric amounts (e.g. "a pinch")
// are returned unchanged so they still render sensibly.
export function scaleAmount(amount: string | null, scale: number): string {
  if (!amount) return "";
  const raw = parseMixedFraction(amount);
  if (isNaN(raw)) return amount;
  const scaled = raw * scale;
  const whole = Math.floor(scaled);
  const frac = Math.round((scaled - whole) * 1000) / 1000;
  const fracSymbol =
    FRACTION_SYMBOLS[frac.toFixed(2)] ?? FRACTION_SYMBOLS[frac.toFixed(3)] ?? null;
  if (frac < 0.01) return String(whole || "");
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
