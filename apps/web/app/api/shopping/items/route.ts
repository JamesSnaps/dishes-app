import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import {
  addItem,
  ShoppingListNotFoundError,
  ShoppingValidationError,
} from "@/lib/services/shopping";

/**
 * Create endpoint for the PWA's offline mutation queue. The client supplies its
 * own `id`, `listId` and `position` so an item created on-device keeps its
 * identity when the queue drains. Response shape is the offline layer's
 * contract — keep it stable.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();

  const body = await req.json();

  try {
    const item = await addItem(session, {
      id: body.id,
      listId: body.listId,
      ingredientName: body.ingredientName ?? "",
      amount: body.amount,
      unit: body.unit,
      category: body.category,
      notes: body.notes,
      position: body.position ?? 0,
    });

    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ShoppingValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ShoppingListNotFoundError) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }
    throw err;
  }
}
