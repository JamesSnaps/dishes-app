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
