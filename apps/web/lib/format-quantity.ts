const UNIT_UPGRADES: Record<string, { threshold: number; factor: number; upgraded: string }> = {
  g:  { threshold: 1000, factor: 1000, upgraded: "kg" },
  ml: { threshold: 1000, factor: 1000, upgraded: "L" },
};

function formatNumber(n: number): string {
  // Up to 2 decimal places, no trailing zeros
  return parseFloat(n.toFixed(2)).toString();
}

export function formatQuantity(
  amount: string | null,
  unit: string | null
): { amount: string | null; unit: string | null } {
  if (amount === null) return { amount, unit };

  const num = parseFloat(amount);
  if (isNaN(num)) return { amount: null, unit };

  const upgrade = unit ? UNIT_UPGRADES[unit.toLowerCase()] : undefined;
  if (upgrade && num >= upgrade.threshold) {
    return {
      amount: formatNumber(num / upgrade.factor),
      unit: upgrade.upgraded,
    };
  }

  return { amount: formatNumber(num), unit };
}

const PEOPLE_UNITS = new Set(["serving", "servings", "people", "person", "persons", "portion", "portions"]);

/**
 * The word to show after a serving count beside the people icon — none when
 * the unit just means people ("4" says servings on its own), the unit itself
 * when it's something else ("12 muffins").
 */
export function servingsUnitLabel(unit: string | null | undefined): string | null {
  const u = unit?.trim();
  return u && !PEOPLE_UNITS.has(u.toLowerCase()) ? u : null;
}
