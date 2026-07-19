import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems } from "@dishes/db/schema";
import { eq, and, count } from "drizzle-orm";
import { getAutheliaUser } from "@/lib/auth";
import { requireHousehold } from "@/lib/household";

export const dynamic = "force-dynamic";

/** Unchecked item count for the active list — feeds the nav badge. */
export async function GET() {
  const user = await getAutheliaUser();
  const { householdId } = await requireHousehold(user);

  const [list] = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(
      and(
        eq(shoppingLists.householdId, householdId),
        eq(shoppingLists.status, "active")
      )
    )
    .limit(1);

  if (!list) return NextResponse.json({ count: 0 });

  const [row] = await db
    .select({ value: count() })
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.listId, list.id),
        eq(shoppingListItems.isChecked, false)
      )
    );

  return NextResponse.json({ count: Number(row?.value ?? 0) });
}
