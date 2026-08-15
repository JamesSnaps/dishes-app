import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { toggleItem, ShoppingItemNotFoundError } from "@/lib/services/shopping";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();

  const { id } = await params;
  const { checked } = await req.json();

  try {
    await toggleItem(session, id, checked);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ShoppingItemNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
