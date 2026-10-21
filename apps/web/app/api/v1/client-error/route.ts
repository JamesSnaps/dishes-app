import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { recordClientError } from "@/lib/client-errors";
import { createLogger } from "@/lib/logger";

const log = createLogger("client-error");

/**
 * POST — the iOS app's crash, hang and memory reports (MetricKit), signed in
 * with its bearer token, into the same `client_errors` table the browser's
 * reports go to (/settings/diagnostics). `{ message, stack?, source?, appVersion?, url? }`.
 * 204 whatever happens, as for the browser's: a reporter must never retry.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = (await req.json()) as Record<string, unknown>;
    await recordClientError(body, {
      userAgent: req.headers.get("user-agent"),
      autheliaUser: session.user.username?.slice(0, 100),
      householdId: session.householdId,
    });
  } catch (err) {
    log.error("client exception (iOS report could not be recorded)", err);
  }
  return new NextResponse(null, { status: 204 });
}
