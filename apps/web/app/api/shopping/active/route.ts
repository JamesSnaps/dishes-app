import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems, recipes } from "@dishes/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export async function GET() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [list] = await db
    .select({ id: shoppingLists.id, name: shoppingLists.name })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.householdId, householdId),
        eq(shoppingLists.status, "active")
      )
    )
    .limit(1);

  if (!list) {
    return NextResponse.json({ listId: null, listName: null, items: [] });
  }

  const items = await db
    .select({
      id: shoppingListItems.id,
      listId: shoppingListItems.listId,
      ingredientName: shoppingListItems.ingredientName,
      amount: shoppingListItems.amount,
      unit: shoppingListItems.unit,
      notes: shoppingListItems.notes,
      isChecked: shoppingListItems.isChecked,
      category: shoppingListItems.category,
      position: shoppingListItems.position,
      recipeId: shoppingListItems.recipeId,
      recipeTitle: recipes.title,
    })
    .from(shoppingListItems)
    .leftJoin(recipes, eq(shoppingListItems.recipeId, recipes.id))
    .where(eq(shoppingListItems.listId, list.id))
    .orderBy(asc(shoppingListItems.position));

  return NextResponse.json({
    listId: list.id,
    listName: list.name,
    items: items.map((i) => ({ ...i, recipeTitle: i.recipeTitle ?? null })),
  });
}
