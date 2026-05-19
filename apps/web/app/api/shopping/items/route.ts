import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export async function POST(req: NextRequest) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const body = await req.json();
  const { id, listId, ingredientName, amount, unit, category, notes, position } = body;

  if (!ingredientName?.trim()) {
    return NextResponse.json({ error: "ingredientName required" }, { status: 400 });
  }

  const [list] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, listId),
        eq(shoppingLists.householdId, householdId)
      )
    )
    .limit(1);

  if (!list) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  const [item] = await db
    .insert(shoppingListItems)
    .values({
      id,
      listId,
      ingredientName: ingredientName.trim(),
      amount: amount || null,
      unit: unit || null,
      category: category || null,
      notes: notes || null,
      position: position ?? 0,
    })
    .returning();

  return NextResponse.json({ item });
}
