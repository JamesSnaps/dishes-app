import { lt, sql } from "drizzle-orm";
import { clientErrors } from "@dishes/db/schema";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/logger";

const log = createLogger("client-error");

/** Oldest rows are dropped past this, so a crash loop can't fill the disk. */
const MAX_STORED = 200;

/**
 * A crash report into `docker logs dishes` and the `client_errors` table that
 * /settings/diagnostics reads back: the browser's (/api/client-error) and the
 * iOS app's MetricKit diagnostics (/api/v1/client-error) alike.
 */
export async function recordClientError(
  body: Record<string, unknown>,
  who: { userAgent?: string | null; autheliaUser?: string; householdId?: string }
): Promise<void> {
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

  const message = text(body.message, 500) ?? "(no message)";
  const digest = text(body.digest, 100);
  const url = text(body.url, 300);
  const source = text(body.source, 50);
  const appVersion = text(body.appVersion, 20);
  const userAgent = text(who.userAgent, 250);
  // Truncated hard: a minified stack is long and the top frames are what matter.
  const stack = text(body.stack, 2000);

  // One line, not an object: console.error pretty-prints an object across a
  // dozen lines, so `docker logs | grep "client exception"` matched the first
  // line and showed nothing useful. The stack goes on its own line after it.
  log.error(
    "client exception " +
      JSON.stringify({ message, digest, url, source, appVersion, standalone: body.standalone === true, userAgent }) +
      (stack ? `\n${stack}` : "")
  );

  await db.insert(clientErrors).values({
    message,
    stack,
    digest,
    url,
    source,
    userAgent,
    appVersion,
    autheliaUser: who.autheliaUser,
    householdId: who.householdId,
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
}
