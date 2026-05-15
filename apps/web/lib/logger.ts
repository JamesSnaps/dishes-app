import { db } from "@/lib/db";
import { appSettings } from "@dishes/db/schema";
import { eq } from "drizzle-orm";
import { LOG_LEVELS, type LogLevel } from "@/lib/log-levels";

export type { LogLevel } from "@/lib/log-levels";
export { LOG_LEVELS, LOG_LEVEL_LABELS } from "@/lib/log-levels";

// Seed from env var so the level is correct before the first DB read
let currentLevel: LogLevel = isValidLevel(process.env.LOG_LEVEL)
  ? (process.env.LOG_LEVEL as LogLevel)
  : "info";

let lastRefresh = 0;

function isValidLevel(v: unknown): v is LogLevel {
  return typeof v === "string" && v in LOG_LEVELS;
}

/** Fire-and-forget refresh from DB every 30s. Never throws. */
function maybeRefresh(): void {
  if (Date.now() - lastRefresh < 30_000) return;
  lastRefresh = Date.now();
  db.select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "log_level"))
    .limit(1)
    .then(([row]) => {
      if (isValidLevel(row?.value)) currentLevel = row.value;
    })
    .catch(() => {});
}

function shouldLog(messageLevel: LogLevel): boolean {
  return LOG_LEVELS[currentLevel] >= LOG_LEVELS[messageLevel];
}

export function createLogger(namespace: string) {
  const p = `[${namespace}]`;
  return {
    debug: (...args: unknown[]) => {
      maybeRefresh();
      if (shouldLog("debug")) console.debug(p, ...args);
    },
    info: (...args: unknown[]) => {
      maybeRefresh();
      if (shouldLog("info")) console.log(p, ...args);
    },
    warn: (...args: unknown[]) => {
      maybeRefresh();
      if (shouldLog("warn")) console.warn(p, ...args);
    },
    error: (...args: unknown[]) => {
      maybeRefresh();
      if (shouldLog("error")) console.error(p, ...args);
    },
  };
}
