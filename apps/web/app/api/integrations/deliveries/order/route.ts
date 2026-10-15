import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import {
  ORDER_UPDATE_KINDS,
  applyOrderUpdate,
  notifyOrderUpdate,
  type OrderUpdateKind,
} from "@/lib/deliveries/orders";

// Record an order from details you've already parsed (no AI involved).
// Body: { kind, deliveryDate?, slot?, total?, orderReference?, retailer? }
export const POST = withIntegrationAuth("write:deliveries", async (req: NextRequest, ctx) => {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const kind = (body.kind ?? "placed") as OrderUpdateKind;
  if (!ORDER_UPDATE_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `kind must be one of ${ORDER_UPDATE_KINDS.join(", ")}` },
      { status: 400 }
    );
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const deliveryDate = str(body.deliveryDate);
  if (deliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    return NextResponse.json({ error: "deliveryDate must be YYYY-MM-DD" }, { status: 400 });
  }
  const total =
    typeof body.total === "number"
      ? body.total
      : typeof body.total === "string" && body.total.trim()
        ? Number(body.total.replace(/[£,\s]/g, ""))
        : null;
  if (!deliveryDate && !str(body.orderReference)) {
    return NextResponse.json(
      { error: "Give a deliveryDate, an orderReference, or both" },
      { status: 400 }
    );
  }

  const update = {
    kind,
    deliveryDate,
    slot: str(body.slot),
    total: total !== null && Number.isFinite(total) ? total : null,
    orderReference: str(body.orderReference),
    retailer: str(body.retailer),
  };
  const result = await applyOrderUpdate(ctx.householdId, update, "api");
  await notifyOrderUpdate(ctx.householdId, update, result);
  return NextResponse.json(result, { status: result.action === "ignored" ? 200 : 201 });
});
