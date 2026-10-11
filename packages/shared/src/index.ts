// Shared types and utilities

export type MemberRole = "admin" | "adult" | "child";
export type Difficulty = "easy" | "medium" | "hard";
export type MealType = "breakfast" | "lunch" | "dinner" | "dessert" | "snack";
export type ListStatus = "active" | "completed" | "archived";

// Canonical meal types a recipe can be tagged as suiting. Matches the
// meal_type DB enum used on meal-plan entries. Used to validate recipes.mealTypes.
export const MEAL_TYPES = [
  "breakfast",
  "lunch",
  "dinner",
  "dessert",
  "snack",
] as const satisfies readonly MealType[];
export type MealPlanStatus = "draft" | "active" | "archived";

// The part a recipe plays in a combined meal (a roast's meat, its potatoes,
// its gravy). Stored as varchar on meal_components and meal_plan_entries and
// validated in app code against this list. Order here is display order.
export const MEAL_ROLES = ["main", "side", "sauce", "other"] as const;
export type MealRole = (typeof MEAL_ROLES)[number];

export const MEAL_ROLE_LABELS: Record<MealRole, string> = {
  main: "Main",
  side: "Side",
  sauce: "Sauce",
  other: "Extra",
};

export function isMealRole(v: unknown): v is MealRole {
  return typeof v === "string" && (MEAL_ROLES as readonly string[]).includes(v);
}

export interface AutheliaUser {
  username: string;
  displayName: string;
  groups: string[];
}

// Integration API token scopes
export const TOKEN_SCOPES = [
  "read:meal_plan",
  "write:meal_plan",
  "read:shopping_list",
  "write:shopping_list",
  "read:recipes",
  "write:recipes",
  "run:automations",
] as const;

export type TokenScope = (typeof TOKEN_SCOPES)[number];

// Standard day index (0=Mon, 6=Sun) used in meal plan entries
export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type DayName = (typeof DAY_NAMES)[number];

// Ingredient unit groups for smart scaling
export const VOLUME_UNITS = ["ml", "l", "tsp", "tbsp", "cup", "fl oz", "pint"] as const;
export const WEIGHT_UNITS = ["g", "kg", "oz", "lb"] as const;
export const COUNT_UNITS = ["whole", "piece", "slice", "can", "bunch", "clove"] as const;
