import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { apiError, withApiErrors } from "@/lib/api/respond";
import { actions } from "@/lib/api/v1-actions";

/**
 * POST `{ "args": [...] }` — one of the website's actions for the app, by name
 * (lib/api/v1-actions.ts). Answers `{ "result": … }`. An action that answers
 * `{ error }` (the web's convention) or throws becomes a 422 with its message.
 */
export const POST = withApiErrors(
  async (req: NextRequest, { params }: { params: Promise<{ name: string }> }) => {
    const session = await requireSession();
    const name = (await params).name;
    const handler = actions[name];
    if (!handler) return apiError("not_found", `No action "${name}"`, 404);
    const body = z.object({ args: z.array(z.unknown()).default([]) }).parse(await req.json().catch(() => ({})));
    let result: unknown;
    try {
      result = await handler(session, body.args);
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
      return apiError("invalid_request", err instanceof Error ? err.message : "That didn't work.", 422);
    }
    if (result && typeof result === "object" && "error" in result && typeof (result as { error?: unknown }).error === "string") {
      return apiError("invalid_request", (result as { error: string }).error, 422);
    }
    return NextResponse.json({ result: result ?? null });
  }
);
