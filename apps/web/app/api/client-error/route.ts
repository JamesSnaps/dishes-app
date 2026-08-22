import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

/**
 * Somewhere for the browser to report a crash.
 *
 * In production Next deliberately redacts client-side error messages, so a
 * phone showing "Application error: a client-side exception has occurred" tells
 * nobody anything — and the console it points at is not reachable on a phone
 * without plugging it into a Mac.
 *
 * This lands the message, stack and digest in `docker logs dishes`, which is
 * the difference between guessing and knowing. Deliberately not under /api/v1:
 * it has no household scoping and returns nothing, because a crash report must
 * work even when the thing that broke was the session or the sync layer.
 *
 * Still behind Authelia in production, so only the household can post to it.
 */

const log = createLogger("client-error");

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    const text = (v: unknown, max: number) =>
      typeof v === "string" ? v.slice(0, max) : undefined;

    log.error("client exception", {
      message: text(body.message, 500) ?? "(no message)",
      digest: text(body.digest, 100),
      url: text(body.url, 300),
      source: text(body.source, 50),
      userAgent: text(req.headers.get("user-agent"), 250),
      // Truncated hard: a minified stack is long and the top frames are what
      // matter.
      stack: text(body.stack, 2000),
    });
  } catch {
    // A malformed report is still a signal that something crashed, but there is
    // nothing useful to do with it and this endpoint must never itself throw.
    log.error("client exception (unparseable report)");
  }

  // 204 regardless: the reporter must never retry or surface a failure of its
  // own on top of the error it is reporting.
  return new NextResponse(null, { status: 204 });
}
