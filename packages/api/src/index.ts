// Shared API response types and helpers

export interface ApiResponse<T> {
  data: T;
  error?: never;
}

export interface ApiError {
  data?: never;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// Integration API types (for n8n, Home Assistant, etc.)
export interface TodayResponse {
  date: string;
  meals: {
    mealType: string;
    recipeId: string;
    recipeTitle: string;
    servings: number | null;
  }[];
}

export interface WeekMealPlanResponse {
  weekStartDate: string;
  days: {
    dayOfWeek: number;
    dayName: string;
    meals: {
      mealType: string;
      recipeId: string;
      recipeTitle: string;
      servings: number | null;
    }[];
  }[];
}

export interface ShoppingListResponse {
  id: string;
  name: string;
  items: {
    id: string;
    ingredientName: string;
    amount: string | null;
    unit: string | null;
    isChecked: boolean;
    category: string | null;
  }[];
}
