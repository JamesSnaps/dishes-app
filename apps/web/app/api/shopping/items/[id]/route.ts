import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

async function authoriseItem(id: string, householdId: string) {
  const [item] = await db
    .select({ listId: shoppingListItems.listId })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.id, id))
    .limit(1);

  if (!item) return false;

  const [list] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.id, item.listId),
        eq(shoppingLists.householdId, householdId)
      )
    )
    .limit(1);

  return Boolean(list);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const { id } = await params;
  const body = await req.json();

  if (!(await authoriseItem(id, householdId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (
    typeof body.ingredientName === "string" &&
    !body.ingredientName.trim()
  ) {
    return NextResponse.json({ error: "ingredientName required" }, { status: 400 });
  }

  const updates: Partial<typeof shoppingListItems.$inferInsert> = {};
  if (typeof body.ingredientName === "string") updates.ingredientName = body.ingredientName.trim();
  if ("amount" in body) updates.amount = body.amount || null;
  if ("unit" in body) updates.unit = body.unit || null;
  if ("notes" in body) updates.notes = body.notes || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db
    .update(shoppingListItems)
    .set(updates)
    .where(eq(shoppingListItems.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const { id } = await params;

  if (!(await authoriseItem(id, householdId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .delete(shoppingListItems)
    .where(eq(shoppingListItems.id, id));

  return NextResponse.json({ ok: true });
}
