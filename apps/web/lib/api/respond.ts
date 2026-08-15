import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth";
import { RecipeNotFoundError, RecipeValidationError } from "@/lib/services/recipes";
import {
  ShoppingItemNotFoundError,
  ShoppingListNotFoundError,
  ShoppingValidationError,
} from "@/lib/services/shopping";
import {
  MealPlanEntryNotFoundError,
  MealPlanNotFoundError,
  MealPlanValidationError,
} from "@/lib/services/meal-plan";

/**
 * Shared error envelope for /api/v1. Every failure the native client can see
 * has the same shape, so the client's error handling is written once:
 *
 *   { "error": { "code": "not_found", "message": "Recipe not found" } }
 */
export type ApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "internal_error";

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; details?: unknown };
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * Wrap a route handler so domain errors map to the envelope instead of leaking
 * a 500 with a stack trace. New service error types get a case here rather than
 * try/catch in every route.
 */
export function withApiErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof AuthError) {
        return apiError("unauthenticated", err.message, 401);
      }
      if (
        err instanceof RecipeNotFoundError ||
        err instanceof ShoppingListNotFoundError ||
        err instanceof ShoppingItemNotFoundError ||
        err instanceof MealPlanNotFoundError ||
        err instanceof MealPlanEntryNotFoundError
      ) {
        return apiError("not_found", err.message, 404);
      }
      if (
        err instanceof RecipeValidationError ||
        err instanceof ShoppingValidationError ||
        err instanceof MealPlanValidationError
      ) {
        return apiError("invalid_request", err.message, 400);
      }
      if (err instanceof ZodError) {
        return apiError("invalid_request", "Invalid request", 400, err.issues);
      }

      console.error("[api/v1] Unhandled error:", err);
      return apiError("internal_error", "Something went wrong", 500);
    }
  };
}
