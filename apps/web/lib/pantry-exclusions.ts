import { db } from "@/lib/db";
import { pantryStaples, pantryStock } from "@dishes/db/schema";
import { eq } from "drizzle-orm";

export interface PantryExclusions {
  stapleNames: Set<string>;
  stock: { ingredientName: string; amount: string | null; unit: string | null }[];
}

/** Load the household's staples and stock for shopping-list filtering. */
export async function getPantryExclusions(
  householdId: string
): Promise<PantryExclusions> {
  const [staples, stock] = await Promise.all([
    db
      .select({ ingredientName: pantryStaples.ingredientName })
      .from(pantryStaples)
      .where(eq(pantryStaples.householdId, householdId)),
    db
      .select({
        ingredientName: pantryStock.ingredientName,
        amount: pantryStock.amount,
        unit: pantryStock.unit,
      })
      .from(pantryStock)
      .where(eq(pantryStock.householdId, householdId)),
  ]);

  return {
    stapleNames: new Set(
      staples.map((s) => s.ingredientName.toLowerCase().trim())
    ),
    stock,
  };
}

/**
 * True when the pantry already covers an ingredient: it's a staple, or the
 * stock holds at least the required amount in the same unit.
 */
export function isCoveredByPantry(
  exclusions: PantryExclusions,
  ingredientName: string,
  requiredAmount: number | null,
  unit: string | null
): boolean {
  const normalName = ingredientName.toLowerCase().trim();

  if (exclusions.stapleNames.has(normalName)) return true;

  if (requiredAmount !== null) {
    const stockItem = exclusions.stock.find(
      (s) =>
        s.ingredientName.toLowerCase().trim() === normalName && s.unit === unit
    );
    if (stockItem?.amount && parseFloat(stockItem.amount) >= requiredAmount) {
      return true;
    }
  }

  return false;
}
