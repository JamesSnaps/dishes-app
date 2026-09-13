import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientErrors, householdMembers } from "@dishes/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import { getAutheliaUser } from "@/lib/auth";

/**
 * Somewhere for the browser to report a crash.
 *
 * In production Next deliberately redacts client-side error messages, so a
 * phone showing "Application error: a client-side exception has occurred" tells
 * nobody anything — and the console it points at is not reachable on a phone
 * without plugging it into a Mac.
 *
 * This lands the message, stack and digest in `docker logs dishes` *and* in the
 * `client_errors` table, which /settings/diagnostics reads back. The log line is
 * for when you have a terminal; the table is for when all you have is the phone
 * that just crashed. Deliberately not under /api/v1: it has no household scoping
 * and returns nothing, because a crash report must work even when the thing that
 * broke was the session or the sync layer.
 *
 * Still behind Authelia in production, so only the household can post to it.
 */

const log = createLogger("client-error");

/** Oldest rows are dropped past this, so a crash loop can't fill the disk. */
const MAX_STORED = 200;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    const text = (v: unknown, max: number) =>
      typeof v === "string" ? v.slice(0, max) : undefined;

    const message = text(body.message, 500) ?? "(no message)";
    const digest = text(body.digest, 100);
    const url = text(body.url, 300);
    const source = text(body.source, 50);
    const appVersion = text(body.appVersion, 20);
    const userAgent = text(req.headers.get("user-agent"), 250);
    // Truncated hard: a minified stack is long and the top frames are what
    // matter.
    const stack = text(body.stack, 2000);

    // One line, not an object: console.error pretty-prints an object across a
    // dozen lines, so `docker logs | grep "client exception"` matched the first
    // line and showed nothing useful. The stack goes on its own line after it.
    log.error(
      "client exception " +
        JSON.stringify({
          message,
          digest,
          url,
          source,
          appVersion,
          standalone: body.standalone === true,
          userAgent,
        }) +
        (stack ? `\n${stack}` : "")
    );

    // Identity is a nice-to-have on a crash report, never a precondition for
    // recording one: whoever it was, the crash still happened.
    let autheliaUser: string | undefined;
    let householdId: string | undefined;
    try {
      const user = await getAutheliaUser();
      autheliaUser = user.username.slice(0, 100);
      const [member] = await db
        .select({ householdId: householdMembers.householdId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.autheliaUser, user.username),
            eq(householdMembers.isActive, true)
          )
        )
        .limit(1);
      householdId = member?.householdId;
    } catch {
      // Unauthenticated or no membership yet — store the report anyway.
    }

    await db.insert(clientErrors).values({
      message,
      stack,
      digest,
      url,
      source,
      userAgent,
      appVersion,
      autheliaUser,
      householdId,
    });

    // Trim to the cap. Cheap enough inline: crashes are rare, and when they are
    // not, this is exactly the path that must stay bounded.
    await db.delete(clientErrors).where(
      lt(
        clientErrors.createdAt,
        sql`(SELECT min(created_at) FROM (
              SELECT created_at FROM client_errors
              ORDER BY created_at DESC LIMIT ${MAX_STORED}
            ) AS keep)`
      )
    );
  } catch (err) {
    // A malformed or unstorable report is still a signal that something crashed,
    // but there is nothing useful to do with it and this endpoint must never
    // itself throw.
    log.error("client exception (report could not be recorded)", err);
  }

  // 204 regardless: the reporter must never retry or surface a failure of its
  // own on top of the error it is reporting.
  return new NextResponse(null, { status: 204 });
}
