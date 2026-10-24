/**
 * Every kind of notification Dishes sends, so each member can choose which they
 * get. Shared by the web settings screen, the iOS app (via /api/v1/notifications)
 * and the senders in lib/push.ts.
 *
 * Dinner and delivery-deadline reminders predate this list and keep their own
 * opt-in columns on household_members (their schedulers query them); the rest
 * live in household_members.notification_prefs, where a missing key means the
 * type's default.
 */

export type NotificationType =
  | "meal_plan"
  | "shopping_ready"
  | "shopping_updated"
  | "dinner"
  | "delivery_deadline"
  | "delivery_booking"
  | "delivery_orders"
  | "cook_timers";

export interface NotificationTypeInfo {
  id: NotificationType;
  title: string;
  description: string;
  group: "Household" | "Cooking" | "Deliveries";
  /** On for members who've never chosen. */
  defaultOn: boolean;
}

export const NOTIFICATION_TYPES: NotificationTypeInfo[] = [
  {
    id: "meal_plan",
    title: "Meal plan ready",
    description: "Someone else adds the week's meal plan",
    group: "Household",
    defaultOn: true,
  },
  {
    id: "shopping_ready",
    title: "Shopping list ready",
    description: "Someone else generates the week's shopping list",
    group: "Household",
    defaultOn: true,
  },
  {
    id: "shopping_updated",
    title: "Shopping list changes",
    description: "Items added or ticked off (at most one every few minutes)",
    group: "Household",
    defaultOn: true,
  },
  {
    id: "dinner",
    title: "Dinner reminders",
    description: "When to start cooking, and each step of a scheduled meal",
    group: "Cooking",
    defaultOn: false,
  },
  {
    id: "cook_timers",
    title: "Cooking timers",
    description: "A timer finishing while the web app is closed",
    group: "Cooking",
    defaultOn: true,
  },
  {
    id: "delivery_deadline",
    title: "Order deadline",
    description: "Before a grocery order closes, with anything missing",
    group: "Deliveries",
    defaultOn: false,
  },
  {
    id: "delivery_booking",
    title: "Book a delivery",
    description: "A few days before a delivery with no order logged yet",
    group: "Deliveries",
    defaultOn: false,
  },
  {
    id: "delivery_orders",
    title: "Order updates",
    description: "A grocery order is confirmed, changed or cancelled",
    group: "Deliveries",
    defaultOn: false,
  },
];

export function isNotificationType(value: string): value is NotificationType {
  return NOTIFICATION_TYPES.some((t) => t.id === value);
}

/** The member columns a choice is read from. */
export interface MemberNotificationFields {
  dinnerReminders: boolean;
  deliveryReminders: boolean;
  notificationPrefs: Record<string, boolean> | null;
}

export function wantsNotification(
  member: MemberNotificationFields,
  type: NotificationType
): boolean {
  if (type === "dinner") return member.dinnerReminders;
  if (type === "delivery_deadline") return member.deliveryReminders;
  const chosen = member.notificationPrefs?.[type];
  if (typeof chosen === "boolean") return chosen;
  // Order updates were sent to everyone with deadline reminders on before they
  // had their own switch, so they (and booking reminders, which came later)
  // follow it until chosen separately.
  if (type === "delivery_orders" || type === "delivery_booking") return member.deliveryReminders;
  return NOTIFICATION_TYPES.find((t) => t.id === type)?.defaultOn ?? true;
}
