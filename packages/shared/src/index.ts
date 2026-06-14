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
