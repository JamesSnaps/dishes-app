import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems } from "@dishes/db/schema";
import { eq, and, max } from "drizzle-orm";

async function getOrCreateActiveList(householdId: string) {
  const [existing] = await db
    .select({ id: shoppingLists.id })
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
    .returning({ id: shoppingLists.id });
  return list!;
}

// Single-item quick-add designed for Siri Shortcuts and voice input.
// Body: { "text": "2 pints of milk" }
export const POST = withIntegrationAuth(
  "write:shopping_list",
  async (req: NextRequest, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const text = String((body as Record<string, unknown>).text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "text must be a non-empty string" }, { status: 400 });
    }

    const list = await getOrCreateActiveList(ctx.householdId);

    const [maxRow] = await db
      .select({ pos: max(shoppingListItems.position) })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, list.id));
    const position = (maxRow?.pos ?? -1) + 1;

    const [row] = await db
      .insert(shoppingListItems)
      .values({ listId: list.id, ingredientName: text, position })
      .returning({ id: shoppingListItems.id });

    return NextResponse.json(
      { added: text, listId: list.id, itemId: row?.id },
      { status: 201 }
    );
  }
);
