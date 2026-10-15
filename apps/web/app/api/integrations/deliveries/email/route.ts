import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import { EmailExtractionError, extractOrderFromEmail } from "@/lib/deliveries/email";
import { applyOrderUpdate, notifyOrderUpdate } from "@/lib/deliveries/orders";

// Forward a retailer's order email (e.g. from n8n); the household's AI reads it
// and the matching delivery is marked ordered, updated or cancelled.
// Body: { subject?, from?, receivedAt?, text? | html? }
export const POST = withIntegrationAuth("write:deliveries", async (req: NextRequest, ctx) => {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  try {
    const { extracted, update } = await extractOrderFromEmail(ctx.householdId, {
      subject: str(body.subject),
      from: str(body.from),
      receivedAt: str(body.receivedAt),
      text: str(body.text),
      html: str(body.html),
    });
    if (!update) {
      return NextResponse.json({ action: "ignored", reason: "Not an order email", extracted });
    }
    const result = await applyOrderUpdate(ctx.householdId, update, "email");
    await notifyOrderUpdate(ctx.householdId, update, result);
    console.info(
      `[deliveries] email household=${ctx.householdId} kind=${update.kind} action=${result.action} ` +
        `date=${result.delivery?.date ?? "-"}`
    );
    return NextResponse.json({ ...result, extracted });
  } catch (err) {
    if (err instanceof EmailExtractionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
});
