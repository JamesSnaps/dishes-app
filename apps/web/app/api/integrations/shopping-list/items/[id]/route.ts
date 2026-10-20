import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems } from "@dishes/db/schema";
import { and, eq } from "drizzle-orm";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => NextResponse.json({ error: "Item not found" }, { status: 404 });

/** The item, if it's on one of this household's lists. */
async function ownedItem(householdId: string, id: string) {
  if (!UUID_RE.test(id)) return null;
  const [item] = await db
    .select({ id: shoppingListItems.id })
    .from(shoppingListItems)
    .innerJoin(shoppingLists, eq(shoppingListItems.listId, shoppingLists.id))
    .where(and(eq(shoppingListItems.id, id), eq(shoppingLists.householdId, householdId)))
    .limit(1);
  return item ?? null;
}

// Ticks an item off (or back on), or renames it.
// Body: { isChecked?: boolean, ingredientName?: string }
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return withIntegrationAuth("write:shopping_list", async (req, ctx) => {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const updates: Partial<typeof shoppingListItems.$inferInsert> = {};
    if ("isChecked" in body) {
      if (typeof body.isChecked !== "boolean") {
        return NextResponse.json({ error: "isChecked must be a boolean" }, { status: 400 });
      }
      updates.isChecked = body.isChecked;
    }
    if ("ingredientName" in body) {
      const name = String(body.ingredientName ?? "").trim();
      if (!name) {
        return NextResponse.json({ error: "ingredientName can't be empty" }, { status: 400 });
      }
      updates.ingredientName = name;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    if (!(await ownedItem(ctx.householdId, id))) return notFound();
    await db.update(shoppingListItems).set(updates).where(eq(shoppingListItems.id, id));
    return NextResponse.json({ id, ...updates });
  })(req);
}

// Removes an item from the list.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return withIntegrationAuth("write:shopping_list", async (_req, ctx) => {
    if (!(await ownedItem(ctx.householdId, id))) return notFound();
    await db.delete(shoppingListItems).where(eq(shoppingListItems.id, id));
    return NextResponse.json({ deleted: id });
  })(req);
}
