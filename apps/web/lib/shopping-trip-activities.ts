import { db } from "@/lib/db";
import { shoppingLists, shoppingListItems } from "@dishes/db/schema";
import { and, eq } from "drizzle-orm";
import { getRedis } from "@/lib/redis";
import { sendLiveActivity } from "@/lib/apns";

/**
 * The iOS shopping-trip Live Activity: "9 left" and the next few items on the
 * Lock Screen while someone's in the shop, kept current over APNs as anyone
 * in the household adds, ticks or removes things.
 *
 * The app starts the activity and hands over its push token
 * (POST /api/v1/live-activities with `shoppingListId`); every write in
 * services/shopping.ts calls shoppingTripChanged(), which — a moment later,
 * once a burst of ticks has settled and the sync transaction has committed —
 * sends each of the household's trips its new state if it changed. The trip
 * ends when the last item is ticked or the list is archived.
 *
 * The content state matches ShoppingTripAttributes.ContentState in
 * apps/ios/Shared, and "next" follows the app's aisle order (shoppingCategories
 * there) so the device and the server agree on what comes next.
 */

interface Registration {
  token: string;
  environment: string;
  householdId: string;
  listId: string;
  /** The state last sent, so an update only goes out when it changes. */
  sent: string | null;
}

export interface ShoppingTripState {
  left: number;
  total: number;
  /** The next few items in aisle order, with ids for the Lock Screen's tick buttons. */
  next: { id: string; name: string }[];
}

const KEY = (token: string) => `liveshop:${token}`;
const HOUSEHOLD = (householdId: string) => `liveshop:hh:${householdId}`;
/** A trip forgotten after this long, if it never finishes. */
const TTL_SECONDS = 12 * 60 * 60;
/** Left on the Lock Screen this long after the last item is ticked. */
const AFTER_DONE_MS = 15 * 60_000;
/** Ticks come in bursts at the shelf; one update per pause. */
const SETTLE_MS = 1500;
/** The same order as the app's shoppingCategories. */
const AISLES = ["Produce", "Dairy", "Meat", "Fish", "Bakery", "Pantry", "Frozen", "Drinks", "Cleaning", "Other"];

declare global {
  var __shoppingTrips: Map<string, Registration> | undefined;
  var __shoppingTripTimers: Map<string, ReturnType<typeof setTimeout>> | undefined;
}
const memory = (globalThis.__shoppingTrips ??= new Map());
const timers = (globalThis.__shoppingTripTimers ??= new Map());

async function save(reg: Registration): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memory.set(reg.token, reg);
    return;
  }
  await redis.set(KEY(reg.token), JSON.stringify(reg), "EX", TTL_SECONDS);
  await redis.sadd(HOUSEHOLD(reg.householdId), reg.token);
  await redis.expire(HOUSEHOLD(reg.householdId), TTL_SECONDS);
}

async function forget(reg: Pick<Registration, "token" | "householdId">): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    memory.delete(reg.token);
    return;
  }
  await redis.del(KEY(reg.token));
  await redis.srem(HOUSEHOLD(reg.householdId), reg.token);
}

async function forHousehold(householdId: string): Promise<Registration[]> {
  const redis = getRedis();
  if (!redis) return [...memory.values()].filter((r) => r.householdId === householdId);
  const out: Registration[] = [];
  for (const token of await redis.smembers(HOUSEHOLD(householdId))) {
    const raw = await redis.get(KEY(token));
    if (raw) out.push(JSON.parse(raw) as Registration);
    else await redis.srem(HOUSEHOLD(householdId), token); // expired
  }
  return out;
}

function aisleRank(category: string | null): [number, string] {
  if (!category) return [2, ""];
  const i = AISLES.indexOf(category);
  return i >= 0 ? [0, String(i).padStart(2, "0")] : [1, category];
}

/** The list's trip state, or null when the list has gone or been archived. */
export async function shoppingTripState(householdId: string, listId: string): Promise<ShoppingTripState | null> {
  const [list] = await db
    .select({ status: shoppingLists.status })
    .from(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.householdId, householdId)));
  if (!list || list.status !== "active") return null;
  const items = await db
    .select({
      id: shoppingListItems.id,
      name: shoppingListItems.ingredientName,
      checked: shoppingListItems.isChecked,
      category: shoppingListItems.category,
      position: shoppingListItems.position,
    })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId));
  const open = items
    .filter((i) => !i.checked)
    .sort((a, b) => {
      const [ra, rb] = [aisleRank(a.category), aisleRank(b.category)];
      return ra[0] - rb[0] || ra[1].localeCompare(rb[1]) || a.position - b.position || a.name.localeCompare(b.name);
    });
  return { left: open.length, total: items.length, next: open.slice(0, 3).map((i) => ({ id: i.id, name: i.name })) };
}

export async function registerShoppingTrip(input: {
  token: string;
  environment: string;
  householdId: string;
  listId: string;
}): Promise<void> {
  const state = await shoppingTripState(input.householdId, input.listId);
  if (!state) return;
  // The app started the activity with its own idea of the state; send ours
  // straight away if it differs (an item added on another device meanwhile).
  await save({ ...input, sent: null });
  shoppingTripChanged(input.householdId);
}

export async function unregisterShoppingTrip(token: string, householdId: string): Promise<void> {
  await forget({ token, householdId });
}

/**
 * After any change to a household's shopping. Fire-and-forget: never awaited,
 * never throws, and it waits SETTLE_MS so a run of ticks sends one update.
 */
export function shoppingTripChanged(householdId: string): void {
  clearTimeout(timers.get(householdId));
  timers.set(
    householdId,
    setTimeout(() => {
      timers.delete(householdId);
      void sendTripUpdates(householdId).catch((err) =>
        console.error(`[shopping-trip] ${householdId} failed:`, err)
      );
    }, SETTLE_MS)
  );
}

async function sendTripUpdates(householdId: string): Promise<void> {
  for (const reg of await forHousehold(householdId)) {
    const state = await shoppingTripState(householdId, reg.listId);
    const now = Date.now();
    if (!state || (state.left === 0 && state.total > 0)) {
      // Archived, or everything's in the basket: say so, then go.
      const final = state ?? { left: 0, total: 0, next: [] };
      await sendLiveActivity(reg.token, reg.environment, "end", { ...final }, {
        dismissalDate: state ? now + AFTER_DONE_MS : now,
      });
      await forget(reg);
      continue;
    }
    const key = JSON.stringify(state);
    if (key === reg.sent) continue;
    const alive = await sendLiveActivity(reg.token, reg.environment, "update", { ...state }, {
      staleDate: now + TTL_SECONDS * 1000,
    });
    if (!alive) await forget(reg);
    else await save({ ...reg, sent: key });
  }
}
