import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems } from "@dishes/db/schema";
import { eq, and, max } from "drizzle-orm";

async function getOrCreateActiveList(householdId: string) {
  const [existing] = await db
    .select({ id: shoppingLists.id, name: shoppingLists.name })
    .from(shoppingLists)
    .where(
      and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.status, "active"))
    )
    .limit(1);

  if (existing) return existing;

  const name = `Shopping – ${new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })}`;
  const [list] = await db
    .insert(shoppingLists)
    .values({ householdId, name })
    .returning({ id: shoppingLists.id, name: shoppingLists.name });
  return list!;
}

// Adds one or more items to the active shopping list.
// Body: { items: [{ ingredientName, amount?, unit?, category? }] }
export const POST = withIntegrationAuth(
  "write:shopping_list",
  async (req: NextRequest, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { items } = body as { items?: unknown[] };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Body must contain a non-empty items array" },
        { status: 400 }
      );
    }

    const list = await getOrCreateActiveList(ctx.householdId);

    const [maxRow] = await db
      .select({ pos: max(shoppingListItems.position) })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, list.id));
    let nextPos = (maxRow?.pos ?? -1) + 1;

    const inserted: string[] = [];
    for (const raw of items) {
      const item = raw as Record<string, unknown>;
      const ingredientName = String(item.ingredientName ?? "").trim();
      if (!ingredientName) continue;

      const [row] = await db
        .insert(shoppingListItems)
        .values({
          listId: list.id,
          ingredientName,
          amount: item.amount ? String(item.amount) : null,
          unit: item.unit ? String(item.unit) : null,
          category: item.category ? String(item.category) : null,
          position: nextPos++,
        })
        .returning({ id: shoppingListItems.id });
      if (row) inserted.push(row.id);
    }

    return NextResponse.json({ added: inserted.length, listId: list.id }, { status: 201 });
  }
);
