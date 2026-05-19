import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems } from "@dishes/db/schema";
import { eq, and } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const { id } = await params;

  const [item] = await db
    .select({ listId: shoppingListItems.listId })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.id, id))
    .limit(1);

  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db
    .delete(shoppingListItems)
    .where(eq(shoppingListItems.id, id));

  return NextResponse.json({ ok: true });
}
