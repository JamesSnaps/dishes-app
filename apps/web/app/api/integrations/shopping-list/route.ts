import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems } from "@dishes/db/schema";
import { eq, and, asc } from "drizzle-orm";

// Returns the current active shopping list with all items.
export const GET = withIntegrationAuth(
  "read:shopping_list",
  async (_req: NextRequest, ctx) => {
    const [list] = await db
      .select({ id: shoppingLists.id, name: shoppingLists.name, createdAt: shoppingLists.createdAt })
      .from(shoppingLists)
      .where(
        and(
          eq(shoppingLists.householdId, ctx.householdId),
          eq(shoppingLists.status, "active")
        )
      )
      .limit(1);

    if (!list) {
      return NextResponse.json({ list: null, items: [] });
    }

    const items = await db
      .select({
        id: shoppingListItems.id,
        ingredientName: shoppingListItems.ingredientName,
        amount: shoppingListItems.amount,
        unit: shoppingListItems.unit,
        category: shoppingListItems.category,
        isChecked: shoppingListItems.isChecked,
        position: shoppingListItems.position,
      })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, list.id))
      .orderBy(asc(shoppingListItems.position));

    return NextResponse.json({ list, items });
  }
);
