export const ALL_SCOPES = [
  "read:meal_plan",
  "write:meal_plan",
  "read:shopping_list",
  "write:shopping_list",
  "read:deliveries",
  "write:deliveries",
  "read:cooking",
  "read:preferences",
  "write:outside_meals",
] as const;

export type TokenScope = (typeof ALL_SCOPES)[number];

/** Scopes whose writes belong to a person, so the token must act as a member. */
export const MEMBER_SCOPES: readonly TokenScope[] = ["write:outside_meals"];
