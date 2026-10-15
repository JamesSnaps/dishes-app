import { describeCutoff, type DeliveryReport } from "./schedule";

/** The next open order as the integrations API returns it. */
export function nextDeliveryJson(report: DeliveryReport | null, today: string) {
  if (!report) return null;
  const { delivery: d, checklist: c } = report;
  return {
    date: d.date,
    status: d.status,
    slot: d.slot,
    total: d.total,
    orderReference: d.orderReference,
    orderBy: new Date(report.cutoffAt).toISOString(),
    orderByLabel: describeCutoff(d, today),
    covers: c.coverage,
    unplannedDinners: c.unplannedDinners,
    mealsNotOnList: c.mealsNotOnList,
    itemsNotInBasket: c.unticked,
    addedSinceOrder: c.addedSinceOrder,
  };
}
