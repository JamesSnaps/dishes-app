import { db } from "@/lib/db";
import { deliveries, householdMembers } from "@dishes/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { sendPushToUsers } from "@/lib/push";
import { getDeliveryConfig, isValidDate, shortDate } from "./schedule";
import { dayOfWeekOf } from "@/lib/dinner-reminders/time";

/**
 * Order updates from outside the app — the retailer's emails (via n8n and AI
 * extraction) or any tool posting structured details. The order reference is
 * the key: a second email about the same order updates it, an amendment that
 * moves the slot to another day moves the delivery with it.
 */

export const ORDER_UPDATE_KINDS = ["placed", "amended", "cancelled", "delivered"] as const;
export type OrderUpdateKind = (typeof ORDER_UPDATE_KINDS)[number];

export interface OrderUpdate {
  kind: OrderUpdateKind;
  deliveryDate?: string | null;
  /** "08:00-09:00". */
  slot?: string | null;
  total?: number | null;
  orderReference?: string | null;
  retailer?: string | null;
}

export interface OrderDeliveryView {
  date: string;
  status: string;
  slot: string | null;
  total: string | null;
  orderReference: string | null;
}

export interface OrderUpdateResult {
  action: "ordered" | "updated" | "cancelled" | "ignored";
  reason?: string;
  delivery: OrderDeliveryView | null;
  /** The date the order was on before an amendment moved it. */
  movedFrom?: string;
}

function clock(part: string, fallbackMeridiem?: string): string | null {
  const m = part.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ?? "00";
  const meridiem = m[3] ?? fallbackMeridiem;
  if (meridiem === "pm" && h < 12) h += 12;
  if (meridiem === "am" && h === 12) h = 0;
  if (h > 23 || Number(min) > 59) return null;
  return `${String(h).padStart(2, "0")}:${min}`;
}

/** Tidies "8:00am - 9:00am", "7-8pm" or "19:00–20:00" into "HH:MM-HH:MM", or null. */
export function normaliseSlot(slot: string | null | undefined): string | null {
  if (!slot) return null;
  const parts = slot.toLowerCase().replace(/\s+/g, "").split(/-|–|—|to/);
  if (parts.length !== 2) return null;
  const endMeridiem = parts[1]!.match(/(am|pm)$/)?.[1];
  const end = clock(parts[1]!);
  // "7-8pm": the start borrows the end's pm when that keeps it before the end.
  let start = clock(parts[0]!);
  if (start && end && endMeridiem && !/(am|pm)$/.test(parts[0]!)) {
    const borrowed = clock(parts[0]!, endMeridiem);
    if (borrowed && borrowed < end) start = borrowed;
  }
  return start && end ? `${start}-${end}` : null;
}

function money(total: number | null | undefined): string | null {
  if (total === null || total === undefined || !Number.isFinite(total)) return null;
  if (total < 0 || total > 100_000) return null;
  return total.toFixed(2);
}

const CLEARED = {
  slot: null,
  total: null,
  orderReference: null,
  orderedAt: null,
  orderedById: null,
};

async function rowBy(householdId: string, where: { date?: string; reference?: string }) {
  const cond = where.reference
    ? eq(deliveries.orderReference, where.reference)
    : eq(deliveries.deliveryDate, where.date!);
  const [row] = await db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.householdId, householdId), cond))
    .limit(1);
  return row ?? null;
}

function view(row: {
  deliveryDate: string;
  status: string;
  slot: string | null;
  total: string | null;
  orderReference: string | null;
}): OrderDeliveryView {
  return {
    date: row.deliveryDate,
    status: row.status,
    slot: row.slot,
    total: row.total,
    orderReference: row.orderReference,
  };
}

/**
 * Release a date an order no longer occupies. A regular delivery day becomes
 * skipped (the order moved, so it shouldn't start nagging); a one-off goes.
 */
async function releaseDate(householdId: string, id: string, date: string) {
  const config = await getDeliveryConfig(householdId);
  if (config.weekdays.includes(dayOfWeekOf(date))) {
    await db
      .update(deliveries)
      .set({ status: "skipped", ...CLEARED })
      .where(eq(deliveries.id, id));
  } else {
    await db.delete(deliveries).where(eq(deliveries.id, id));
  }
}

export async function applyOrderUpdate(
  householdId: string,
  update: OrderUpdate,
  source: "email" | "api"
): Promise<OrderUpdateResult> {
  const reference = update.orderReference?.trim().slice(0, 100) || null;
  const date = update.deliveryDate && isValidDate(update.deliveryDate) ? update.deliveryDate : null;
  const slot = normaliseSlot(update.slot);
  const total = money(update.total);

  const byRef = reference ? await rowBy(householdId, { reference }) : null;

  if (update.kind === "placed" || update.kind === "amended") {
    const target = date ?? byRef?.deliveryDate ?? null;
    if (!target) return { action: "ignored", reason: "No delivery date found", delivery: null };

    let movedFrom: string | undefined;
    if (byRef && byRef.deliveryDate !== target) {
      movedFrom = byRef.deliveryDate;
      await releaseDate(householdId, byRef.id, byRef.deliveryDate);
    }
    const existing = byRef && !movedFrom ? byRef : await rowBy(householdId, { date: target });
    const wasOrdered = existing?.status === "ordered";

    // A fresh order time on every confirmation or amendment: anything added to
    // the list after it is what still needs amending in.
    const values = {
      status: "ordered",
      slot: slot ?? (wasOrdered ? existing?.slot ?? null : null),
      total: total ?? (wasOrdered ? existing?.total ?? null : null),
      orderReference: reference ?? (wasOrdered ? existing?.orderReference ?? null : null),
      orderedAt: sql`now()`,
      source,
    };
    const [row] = await db
      .insert(deliveries)
      .values({ householdId, deliveryDate: target, ...values })
      .onConflictDoUpdate({
        target: [deliveries.householdId, deliveries.deliveryDate],
        set: values,
      })
      .returning();
    return {
      action: wasOrdered || movedFrom ? "updated" : "ordered",
      delivery: view(row!),
      ...(movedFrom ? { movedFrom } : {}),
    };
  }

  const existing = byRef ?? (date ? await rowBy(householdId, { date }) : null);

  if (update.kind === "cancelled") {
    if (!existing) return { action: "ignored", reason: "No matching order", delivery: null };
    // Back to an unordered delivery so the reminders pick it up again; skip it
    // in the app if it isn't happening at all.
    const [row] = await db
      .update(deliveries)
      .set({ status: "scheduled", ...CLEARED, source })
      .where(eq(deliveries.id, existing.id))
      .returning();
    return { action: "cancelled", delivery: view(row!) };
  }

  // delivered: record the final charged total.
  if (!existing) {
    if (!date) return { action: "ignored", reason: "No matching order", delivery: null };
    const [row] = await db
      .insert(deliveries)
      .values({
        householdId,
        deliveryDate: date,
        status: "ordered",
        slot,
        total,
        orderReference: reference,
        orderedAt: sql`now()`,
        source,
      })
      .returning();
    return { action: "updated", delivery: view(row!) };
  }
  const [row] = await db
    .update(deliveries)
    .set({
      status: "ordered",
      ...(total ? { total } : {}),
      ...(slot ? { slot } : {}),
      ...(reference ? { orderReference: reference } : {}),
      orderedAt: existing.orderedAt ?? sql`now()`,
    })
    .where(eq(deliveries.id, existing.id))
    .returning();
  return { action: "updated", delivery: view(row!) };
}

/** Tell opted-in members an order was confirmed, moved or cancelled. */
export async function notifyOrderUpdate(
  householdId: string,
  update: OrderUpdate,
  result: OrderUpdateResult
): Promise<void> {
  if (result.action === "ignored" || !result.delivery || update.kind === "delivered") return;
  const members = await db
    .select({ user: householdMembers.autheliaUser })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.deliveryReminders, true),
        eq(householdMembers.isActive, true)
      )
    );
  if (!members.length) return;

  const shop = update.retailer?.trim() || "Grocery";
  const d = result.delivery;
  const details = [shortDate(d.date), d.slot, d.total ? `£${d.total}` : null]
    .filter(Boolean)
    .join(" · ");
  const payload =
    result.action === "cancelled"
      ? {
          title: `${shop} order cancelled`,
          body: `${shortDate(d.date)}'s delivery isn't ordered any more. Reorder or skip it in the planner.`,
        }
      : {
          title:
            update.kind === "amended" || result.action === "updated"
              ? `${shop} order updated`
              : `${shop} order confirmed`,
          body: result.movedFrom
            ? `Moved from ${shortDate(result.movedFrom)} to ${details}`
            : details,
        };
  await sendPushToUsers(
    householdId,
    members.map((m) => m.user),
    { ...payload, url: "/meal-plan", tag: `delivery-${d.date}` }
  ).catch((err) => console.error("[deliveries] order push failed:", err));
}
