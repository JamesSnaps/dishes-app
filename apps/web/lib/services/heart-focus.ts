import { db } from "@/lib/db";
import { householdMembers } from "@dishes/db/schema";
import { and, eq } from "drizzle-orm";
import { CHOLESTEROL_DIETARY_FLAG, mentionsCholesterolDiet } from "@/lib/heart-healthy";

/**
 * Whether anyone active in the household is on a cholesterol-lowering diet —
 * the dietary toggle, or older free-text notes that say so. Decides whether
 * heart-healthy extras (shopping swaps, weekly targets) are worth showing.
 */
export async function householdHasCholesterolDiet(householdId: string): Promise<boolean> {
  const rows = await db
    .select({ dietaryFlags: householdMembers.dietaryFlags, customNotes: householdMembers.customNotes })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.isActive, true)));

  return rows.some(
    (m) => m.dietaryFlags?.includes(CHOLESTEROL_DIETARY_FLAG) || mentionsCholesterolDiet([m.customNotes])
  );
}
