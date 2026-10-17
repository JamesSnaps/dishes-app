import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/respond";

/**
 * The AI actions answer `{ error }` rather than throwing (the web shows the
 * message as is), so the routes turn that into the /api/v1 envelope: 422 with
 * the action's own words — "AI not configured…", "Rate limited…".
 */
export function fromAction<T extends { error?: string }>(result: T, status = 200) {
  if (result.error) return apiError("invalid_request", result.error, 422);
  return NextResponse.json(result, { status });
}
