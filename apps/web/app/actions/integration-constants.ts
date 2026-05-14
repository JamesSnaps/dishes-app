export const ALL_SCOPES = [
  "read:meal_plan",
  "write:meal_plan",
  "read:shopping_list",
  "write:shopping_list",
] as const;

export type TokenScope = (typeof ALL_SCOPES)[number];
