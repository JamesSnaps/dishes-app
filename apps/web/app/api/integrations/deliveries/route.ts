import { NextRequest, NextResponse } from "next/server";
import { withIntegrationAuth } from "@/lib/integration-auth";
import {
  cutoffEpoch,
  getDeliveryConfig,
  getNextOpenDelivery,
  listDeliveries,
} from "@/lib/deliveries/schedule";
import { nextDeliveryJson } from "@/lib/deliveries/json";
import { addDaysToDate, localNow } from "@/lib/dinner-reminders/time";

// The next open order with its to-do checklist, plus deliveries for two weeks.
export const GET = withIntegrationAuth("read:deliveries", async (_req: NextRequest, ctx) => {
  const config = await getDeliveryConfig(ctx.householdId);
  const today = localNow(config.timezone).date;
  const [next, upcoming] = await Promise.all([
    getNextOpenDelivery(ctx.householdId, config),
    listDeliveries(ctx.householdId, today, addDaysToDate(today, 13), config),
  ]);

  return NextResponse.json({
    today,
    timezone: config.timezone,
    deliveryWeekdays: config.weekdays,
    next: nextDeliveryJson(next, today),
    upcoming: upcoming.map((d) => ({
      date: d.date,
      status: d.status,
      regular: d.regular,
      away: d.away?.label ?? (d.away ? "Away" : null),
      slot: d.slot,
      total: d.total,
      orderReference: d.orderReference,
      orderBy: new Date(cutoffEpoch(d, config.timezone)).toISOString(),
    })),
  });
});
