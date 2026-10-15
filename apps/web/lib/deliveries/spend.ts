import { db } from "@/lib/db";
import { deliveries } from "@dishes/db/schema";
import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";
import { weekStartOf } from "@/lib/dinner-reminders/time";
import { shortDate } from "./dates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface GrocerySpend {
  orders: number;
  total: number;
  averagePerOrder: number | null;
  /** Spread over the weeks from the first order to the end of the range. */
  averagePerWeek: number | null;
  /** By week for short ranges, by month otherwise. Oldest first. */
  periods: { key: string; label: string; total: number; orders: number }[];
  byWeek: boolean;
}

/**
 * What the household spent on grocery deliveries in [from, to]: every ordered
 * delivery with a total (from retailer emails, or entered via the API).
 */
export async function getGrocerySpend(
  householdId: string,
  from: string,
  to: string
): Promise<GrocerySpend> {
  const rows = await db
    .select({ date: deliveries.deliveryDate, total: deliveries.total })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.householdId, householdId),
        eq(deliveries.status, "ordered"),
        isNotNull(deliveries.total),
        gte(deliveries.deliveryDate, from),
        lte(deliveries.deliveryDate, to)
      )
    )
    .orderBy(asc(deliveries.deliveryDate));

  const orders = rows.map((r) => ({ date: r.date, total: Number(r.total) }));
  const total = orders.reduce((sum, o) => sum + o.total, 0);
  const first = orders[0]?.date;
  const days = first
    ? (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000 + 1
    : 0;
  const weeks = Math.max(1, days / 7);
  const rangeDays =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  const byWeek = rangeDays <= 63;

  const periods = new Map<string, { key: string; label: string; total: number; orders: number }>();
  for (const o of orders) {
    const key = byWeek ? weekStartOf(o.date) : o.date.slice(0, 7);
    const label = byWeek
      ? `w/c ${shortDate(key).slice(4)}`
      : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
    const p = periods.get(key) ?? { key, label, total: 0, orders: 0 };
    p.total += o.total;
    p.orders += 1;
    periods.set(key, p);
  }

  return {
    orders: orders.length,
    total,
    averagePerOrder: orders.length ? total / orders.length : null,
    averagePerWeek: orders.length ? total / weeks : null,
    periods: [...periods.values()],
    byWeek,
  };
}

