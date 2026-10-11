import { isMealRole, type MealRole } from "@dishes/shared";

/**
 * Integration responses describe a combined meal on each of its entries as
 * `mealGroup: { id, title, role }`, or null for a dish planned on its own.
 * Additive: consumers that ignore it see exactly the entries they always did.
 */
export function withMealGroup<
  T extends { groupId: string | null; groupTitle: string | null; mealRole: string | null },
>({ groupId, groupTitle, mealRole, ...entry }: T) {
  const mealGroup: { id: string; title: string; role: MealRole } | null =
    groupId && groupTitle
      ? { id: groupId, title: groupTitle, role: isMealRole(mealRole) ? mealRole : "side" }
      : null;
  return { ...entry, mealGroup };
}
