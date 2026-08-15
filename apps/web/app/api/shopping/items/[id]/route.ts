import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import {
  deleteItem,
  updateItem,
  ShoppingItemNotFoundError,
  ShoppingValidationError,
  type UpdateItemInput,
} from "@/lib/services/shopping";

/** Offline mutation-queue endpoints. Response shapes are the offline contract. */

type RouteContext = { params: Promise<{ id: string }> };

function toResponse(err: unknown): NextResponse {
  if (err instanceof ShoppingItemNotFoundError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (err instanceof ShoppingValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  throw err;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await requireSession();

  const { id } = await params;
  const body = await req.json();

  // Only forward keys the client actually sent — the service distinguishes
  // "field absent" from "field set to null".
  const input: UpdateItemInput = {};
  if ("ingredientName" in body) input.ingredientName = body.ingredientName;
  if ("amount" in body) input.amount = body.amount;
  if ("unit" in body) input.unit = body.unit;
  if ("notes" in body) input.notes = body.notes;
  if ("category" in body) input.category = body.category;

  try {
    await updateItem(session, id, input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await requireSession();

  const { id } = await params;

  try {
    await deleteItem(session, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
